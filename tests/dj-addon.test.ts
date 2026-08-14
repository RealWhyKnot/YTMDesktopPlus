import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi, type Mock } from "vitest";
import djAddon from "../src/addons/bundled/dj";
import { ANALYSIS_VERSION } from "../src/addons/bundled/dj/feature-db";
import { fakeAddonContext, makeVideoDetails } from "./helpers/fake-addon-context";
import { RepeatMode, type PlayerQueue, type PlayerQueueItem } from "../src/shared/addons/sdk";
import { makeTempDir } from "./helpers/temp-dir";

function fakeContext(overrides: { settings?: Record<string, unknown> } = {}) {
  const bag = fakeAddonContext({
    manifest: djAddon.manifest,
    settings: { fadeOut: 5, fadeIn: 1.5, curve: 0, fadeOnManualSkip: true, fadeOnRepeatOne: false, autoDj: false, ...overrides.settings }
  });
  bag.ctx.paths.data = makeTempDir("dj-addon-");
  return bag;
}

function makeQueue(overrides: Partial<PlayerQueue> = {}): PlayerQueue {
  return {
    automixItems: [],
    autoplay: false,
    isGenerating: false,
    isInfinite: false,
    items: [],
    repeatMode: RepeatMode.None,
    selectedItemIndex: 0,
    ...overrides
  };
}

// The addon never reads the ipc event itself, only its payload.
const IPC_EVENT = {} as never;

const crossfadeArgs = (captured: ReturnType<typeof fakeContext>["captured"]) =>
  captured.invocations.filter(entry => entry.name === "crossfade").map(entry => entry.arg);

describe("dj bundled addon", () => {
  it("ships disabled, since it changes how playback sounds", () => {
    expect(djAddon.manifest.defaultEnabled).toBe(false);
  });

  it("registers the page scripts", async () => {
    const { ctx, captured } = fakeContext();
    await djAddon.activate(ctx);
    expect(Object.keys(captured.scripts).sort()).toEqual(["catalog", "crossfade", "crossfade-disable", "enqueue"]);
  });

  it("offers number-valued curve options, which is all a select field accepts", async () => {
    const { ctx, captured } = fakeContext();
    await djAddon.activate(ctx);
    const fields = captured.sections.flatMap(section => section.fields);
    const curve = fields.find(field => field.key === "curve");
    const values = curve?.type === "select" ? curve.options.map(option => option.value) : [];
    expect(values).toEqual([0, 1, 2]);
    expect(fields.find(field => field.key === "autoDj")?.type).toBe("toggle");
  });

  it("pushes the current settings into the page each time it loads", async () => {
    const { ctx, captured } = fakeContext({ settings: { fadeOut: 8, curve: 1 } });
    await djAddon.activate(ctx);
    await captured.loadedCallbacks[0]();
    expect(crossfadeArgs(captured).at(-1)).toEqual({
      enabled: true,
      fadeOutS: 8,
      fadeInS: 1.5,
      curve: 1,
      fadeOnManualSkip: true,
      fadeOnRepeatOne: false,
      repeatOne: false,
      adPlaying: false,
      hasNext: true,
      transitionIndex: null,
      beatOffsetS: null,
      beatPeriodS: null,
      incomingRate: null,
      rateGlideS: 6
    });
  });

  it("reapplies with repeatOne when the repeat mode flips to one", async () => {
    const { ctx, captured, emitPlayerEvent } = fakeContext();
    await djAddon.activate(ctx);
    emitPlayerEvent("repeatModeChanged", { repeatMode: RepeatMode.One });
    await Promise.resolve();
    expect(crossfadeArgs(captured).at(-1)).toMatchObject({ repeatOne: true });
  });

  it("reports no next track only when the queue is exhausted and finite", async () => {
    const { ctx, captured, emitPlayerEvent } = fakeContext();
    await djAddon.activate(ctx);
    emitPlayerEvent("queueChanged", { queue: makeQueue({ items: [{} as never], selectedItemIndex: 0 }) });
    await Promise.resolve();
    expect(crossfadeArgs(captured).at(-1)).toMatchObject({ hasNext: false });
  });

  it("spins up the hidden analysis window for valid audio and ignores junk", async () => {
    const { ctx, captured, emitViewMessage } = fakeContext();
    await djAddon.activate(ctx);

    emitViewMessage("audioData", { videoId: 42, buffer: "nope" });
    emitViewMessage("audioData", null);
    expect(captured.windows).toHaveLength(0);

    emitViewMessage("audioData", { videoId: "vid", buffer: new ArrayBuffer(8) });
    expect(captured.windows).toHaveLength(1);
    expect(ctx.windows.create).toHaveBeenCalledWith(expect.objectContaining({ entry: "dj-analysis", show: false }));
  });

  it("writes page transition reports to the log, where they can be read back", async () => {
    const { ctx, emitViewMessage } = fakeContext();
    await djAddon.activate(ctx);

    emitViewMessage("diag", { event: "plainFade", videoId: "vid", reason: "tail unavailable" });
    expect(ctx.log.info).toHaveBeenCalledWith("transition plainFade videoId=vid reason=tail unavailable");

    emitViewMessage("diag", { event: "overlap" });
    expect(ctx.log.info).toHaveBeenCalledWith("transition overlap");

    (ctx.log.info as Mock).mockClear();
    emitViewMessage("diag", { reason: "no event name" });
    emitViewMessage("diag", null);
    expect(ctx.log.info).not.toHaveBeenCalled();
  });

  it("releases a wedged analysis so later tracks still get catalogued", async () => {
    vi.useFakeTimers();
    try {
      const { ctx, captured, emitViewMessage, emitPlayerEvent } = fakeContext();
      await djAddon.activate(ctx);
      emitViewMessage("audioData", { videoId: "stuck", buffer: new ArrayBuffer(8) });
      captured.ipcHandlers.analysisReady(IPC_EVENT);

      // The window never answers: without a timeout this id stays in flight
      // and every later catalog for it is skipped for the rest of the session.
      emitPlayerEvent("trackChanged", { current: makeVideoDetails({ id: "stuck" }), previous: null, playlistId: null });
      await vi.advanceTimersByTimeAsync(13000);
      expect(captured.invocations.some(entry => entry.name === "catalog")).toBe(false);

      await vi.advanceTimersByTimeAsync(120000);
      expect(ctx.log.info).toHaveBeenCalledWith("Analysis timed out for stuck");

      emitPlayerEvent("trackChanged", { current: makeVideoDetails({ id: "stuck" }), previous: null, playlistId: null });
      await vi.advanceTimersByTimeAsync(13000);
      expect(captured.invocations.filter(entry => entry.name === "catalog").map(entry => entry.arg)).toEqual([{ videoId: "stuck" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fills in the title of a track that was analyzed after the user skipped on", async () => {
    const { ctx, captured, emitViewMessage, emitPlayerEvent } = fakeContext();
    const instance = await djAddon.activate(ctx);
    emitViewMessage("audioData", { videoId: "late", buffer: new ArrayBuffer(8) });
    captured.ipcHandlers.analysisReady(IPC_EVENT);
    captured.ipcHandlers.analysisResult(IPC_EVENT, {
      videoId: "late",
      ok: true,
      bpm: 120,
      bpmOffset: 0.1,
      chromaMean: new Array(12).fill(1),
      rmsP50: 0.1,
      rmsP90: 0.2,
      decodedDurationS: 180
    });

    // Nothing was playing when the bytes landed, so the record has no title and
    // the library pool would ignore it for good.
    emitPlayerEvent("trackChanged", {
      current: makeVideoDetails({ id: "late", title: "Late Title", author: "Late Author" }),
      previous: null,
      playlistId: null
    });
    await (instance as { destroy: () => Promise<void> }).destroy();

    const stored = JSON.parse(readFileSync(path.join(ctx.paths.data, "features.json"), "utf8")).tracks.late;
    expect(stored).toMatchObject({ title: "Late Title", author: "Late Author" });
  });

  it("executes page-requested transitions through playQueueIndex", async () => {
    const { ctx, emitViewMessage } = fakeContext();
    await djAddon.activate(ctx);
    emitViewMessage("transitionNow", { index: 7 });
    expect(ctx.playback.playQueueIndex).toHaveBeenCalledWith(7);
    emitViewMessage("transitionNow", { index: -1 });
    emitViewMessage("transitionNow", { index: 1.5 });
    emitViewMessage("transitionNow", {});
    expect(ctx.playback.playQueueIndex).toHaveBeenCalledTimes(1);
  });

  it("schedules cataloging a while after a track starts", async () => {
    vi.useFakeTimers();
    try {
      const { ctx, captured, emitPlayerEvent } = fakeContext();
      await djAddon.activate(ctx);
      emitPlayerEvent("trackChanged", { current: makeVideoDetails({ id: "fresh" }), previous: null, playlistId: null });
      expect(captured.invocations.some(entry => entry.name === "catalog")).toBe(false);
      await vi.advanceTimersByTimeAsync(13000);
      expect(captured.invocations.filter(entry => entry.name === "catalog").map(entry => entry.arg)).toEqual([{ videoId: "fresh" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the badge only while auto DJ is on", async () => {
    const { ctx, captured, settings, emitPlayerEvent } = fakeContext();
    await djAddon.activate(ctx);
    emitPlayerEvent("trackChanged", { current: makeVideoDetails(), previous: null, playlistId: null });
    expect(captured.badges.at(-1)).toBeNull();

    settings.autoDj = true;
    await captured.settingsListeners.autoDj();
    expect(captured.badges.at(-1)).toMatchObject({ active: true });
  });

  it("survives the page rejecting the script rather than taking the addon down", async () => {
    const bag = fakeAddonContext({
      manifest: djAddon.manifest,
      invokeScript: async () => {
        throw new Error("no such script");
      }
    });
    bag.ctx.paths.data = makeTempDir("dj-addon-");
    await djAddon.activate(bag.ctx);
    await expect(bag.captured.loadedCallbacks[0]()).resolves.not.toThrow();
    expect(bag.ctx.log.warn).toHaveBeenCalled();
  });

  it("enqueues a clearly better library track through innertube and the page", async () => {
    const dataDir = makeTempDir("dj-addon-");
    const record = (videoId: string, extras: Record<string, unknown> = {}) => ({
      videoId,
      title: `title of ${videoId}`,
      author: "someone",
      bpm: 128,
      camelot: "8B",
      keyConfidence: 1,
      energy: 0.5,
      durationS: 200,
      beatOffsetS: 0.2,
      analysisVersion: ANALYSIS_VERSION,
      analyzedAt: 0,
      ...extras
    });
    writeFileSync(
      path.join(dataDir, "features.json"),
      JSON.stringify({ analysisVersion: ANALYSIS_VERSION, tracks: { current: record("current"), lib: record("lib", { author: "other" }) } }),
      "utf8"
    );

    const bag = fakeAddonContext({
      manifest: djAddon.manifest,
      settings: { fadeOut: 5, fadeIn: 1.5, curve: 0, fadeOnManualSkip: true, fadeOnRepeatOne: false, autoDj: true },
      innertube: async () => ({ contents: [{ playlistPanelVideoRenderer: { videoId: "lib", navigationEndpoint: {} } }] }),
      invokeScript: async name => (name === "enqueue" ? 1 : true)
    });
    bag.ctx.paths.data = dataDir;

    const queueItem = (videoId: string): PlayerQueueItem => ({
      videoId,
      title: videoId,
      author: "someone",
      duration: "3:20",
      thumbnails: [],
      selected: false,
      counterparts: null
    });
    const queue: PlayerQueue = {
      items: [queueItem("current"), queueItem("unknown")],
      automixItems: [],
      autoplay: false,
      isGenerating: false,
      isInfinite: false,
      repeatMode: RepeatMode.None,
      selectedItemIndex: 0
    };
    (bag.ctx.player.getQueue as Mock).mockReturnValue(queue);

    await djAddon.activate(bag.ctx);
    bag.emitPlayerEvent("trackChanged", { current: makeVideoDetails({ id: "current" }), previous: null, playlistId: null });
    await vi.waitFor(() => {
      expect(bag.captured.innertubeCalls).toContainEqual({ endpoint: "next", body: { videoId: "lib" } });
      expect(bag.captured.invocations.some(entry => entry.name === "enqueue")).toBe(true);
    });
    expect(bag.captured.badges.at(-1)?.tooltip).toContain("title of lib");
  });

  it("tears the page engine down and drops listeners on destroy", async () => {
    const { ctx, unsubscribe } = fakeContext();
    const instance = await djAddon.activate(ctx);
    await (instance as { destroy: () => Promise<void> }).destroy();
    expect(ctx.ytmview.runScript).toHaveBeenCalledWith("crossfade-disable");
    expect(unsubscribe).toHaveBeenCalledTimes(14);
  });
});
