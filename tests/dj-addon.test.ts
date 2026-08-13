import { writeFileSync } from "node:fs";
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
      bpmConfidence: 1,
      camelot: "8B",
      keyConfidence: 1,
      energy: 0.5,
      loudnessDb: null as number | null,
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
    expect(unsubscribe).toHaveBeenCalledTimes(13);
  });
});
