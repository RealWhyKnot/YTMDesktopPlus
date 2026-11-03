import { requireValue, requireRecord } from "./helpers/require-value";
import { afterEach, describe, expect, it, vi } from "vitest";
import { arrayOf, isBoolean, isNumber, isString, nullable, objectOf, optional } from "../src/shared/validation";
import { isRecord } from "../src/shared/unknown";

import { lyricsAddon, LRCLIB_URL, counterpartIds, durationFromText, lyricsCss } from "../src/addons/bundled/lyrics";
import { fakeAddonContext, makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";
import { RepeatMode, type PlayerQueue, type PlayerQueueItem, type VideoDetails } from "../src/shared/addons/sdk";
import { partialPlayerState } from "./helpers/partial-player-state";

const VERSE = ["I walked along the river", "the water running cold", "you said the night was ours", "and never let it go", "we sang until the morning"];
const TIMED = VERSE.map((line, index) => ({
  lyricLine: line,
  cueRange: { startTimeMilliseconds: String(1000 + index * 3000), endTimeMilliseconds: String(4000 + index * 3000) },
}));
const UNTIMED = VERSE.map((line) => ({ lyricLine: line }));
const SYNCED = VERSE.map((line, index) => `[00:${String(10 + index * 4).padStart(2, "0")}.00]${line}`).join("\n");

function item(videoId: string, duration: string, counterparts: PlayerQueueItem[] | null = null): PlayerQueueItem {
  return { thumbnails: [], title: "River", author: "Someone", duration, selected: false, videoId, counterparts };
}

function queue(items: PlayerQueueItem[]): PlayerQueue {
  return { automixItems: [], autoplay: true, isGenerating: false, isInfinite: false, items, repeatMode: RepeatMode.None, selectedItemIndex: 0 };
}

type FetchResult = { lines: unknown; source: string | null } | null;

function harness(options: { settings?: Record<string, unknown>; ytm?: Record<string, FetchResult | Error>; queue?: PlayerQueue | null } = {}) {
  const bag = fakeAddonContext({
    manifest: lyricsAddon.manifest,
    settings: options.settings,
    invokeScript: (name, arg) => {
      if (name !== "fetch") return Promise.resolve(true);
      if (!isRecord(arg) || typeof arg.videoId !== "string") return Promise.reject(new Error("Missing lyric video id"));
      const answer = options.ytm?.[arg.videoId] ?? null;
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  });
  bag.ctx.player.getQueue = vi.fn(() => options.queue ?? null);
  return bag;
}

async function play(bag: ReturnType<typeof harness>, video: VideoDetails) {
  for (const listener of bag.captured.eventListeners.trackChanged ?? []) listener({ current: video, previous: null });
  await bag.waitForInvocation("render", (arg) => isRender(arg) && arg.videoId === video.id && !arg.pending);
  return requireValue(
    renders(bag)
      .filter((arg) => arg.videoId === video.id && !arg.pending)
      .at(-1)
  );
}

const isRender = objectOf({
  videoId: isString,
  pending: optional(isBoolean),
  lines: nullable(arrayOf(objectOf({ text: isString, start: nullable(isNumber) }))),
  timed: optional(isBoolean),
  source: optional(nullable(isString)),
});

function renders(bag: ReturnType<typeof fakeAddonContext>) {
  return bag.captured.invocations
    .filter((call) => call.name === "render")
    .map((call) => {
      if (!isRender(call.arg)) throw new Error("Invalid lyric render request");
      return call.arg;
    });
}

function stubLrclib(responses: unknown[][]) {
  const fetchMock = vi.fn((_url: string) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(responses.shift() ?? []) }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("lyrics bundled addon", () => {
  it.each([
    { videoId: "vid", title: "Song" },
    { videoId: "vid", author: "Artist" },
  ])("keeps YouTube lyrics without an LRCLIB request for partial metadata %j", async (payload) => {
    const fetchMock = stubLrclib([]);
    const bag = harness({ ytm: { vid: { lines: UNTIMED, source: "Source: Musixmatch" } } });
    lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, requireValue(partialPlayerState(payload).videoDetails));
    expect(shown).toMatchObject({ timed: false, source: "Source: Musixmatch" });
    expect(shown.lines?.map((line) => line.text)).toEqual(VERSE);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(bag.ctx.log.warn).not.toHaveBeenCalled();
  });
  it("ships on, with the size picker and the LRCLIB toggle", () => {
    const bag = harness();
    lyricsAddon.activate(bag.ctx);
    expect(lyricsAddon.manifest.defaultEnabled).toBe(true);
    expect(bag.captured.sections.flatMap((section) => section.fields).map((field) => field.key)).toEqual(["textSize", "lrclib"]);
    expect(Object.keys(bag.captured.scripts)).toEqual(["fetch", "render"]);
    expect(bag.ctx.ytmview.insertCSS).toHaveBeenCalledWith(lyricsCss(18));
  });

  it("uses YouTube Music's own timed lyrics and never calls LRCLIB for them", async () => {
    const fetchMock = stubLrclib([]);
    const bag = harness({ ytm: { vid: { lines: TIMED, source: "Source: Musixmatch" } } });
    lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, makeVideoDetails());
    expect(shown.timed).toBe(true);
    expect(shown.source).toBe("Source: Musixmatch");
    expect(shown.lines?.[1]).toMatchObject({ text: VERSE[1], start: 4000 });
    expect(renders(bag)[0]).toMatchObject({ videoId: "vid", pending: true, lines: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("borrows timings from a counterpart of the same length", async () => {
    stubLrclib([]);
    const bag = harness({
      ytm: { vid: { lines: UNTIMED, source: "a" }, video2: { lines: TIMED, source: "b" }, long: { lines: TIMED, source: "c" } },
      queue: queue([item("vid", "3:00", [item("long", "3:30"), item("video2", "3:01")])]),
    });
    lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, makeVideoDetails());
    expect(shown).toMatchObject({ timed: true, source: "b" });
    expect(bag.captured.invocations.filter((call) => call.name === "fetch").map((call) => requireRecord(call.arg).videoId)).toEqual(["vid", "video2"]);
  });

  it("falls back to LRCLIB when YouTube Music has only plain text", async () => {
    const fetchMock = stubLrclib([[{ id: 1, trackName: "River", artistName: "Someone", duration: 180, syncedLyrics: SYNCED }]]);
    const bag = harness({ ytm: { vid: { lines: UNTIMED, source: "Source: Musixmatch" } } });
    lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, makeVideoDetails({ title: "River (Official Video)", author: "Someone - Topic" }));
    expect(shown).toMatchObject({ timed: true, source: "Source: LRCLIB" });
    const url = new URL(requireValue(fetchMock.mock.calls[0])[0]);
    expect(url.origin + url.pathname).toBe(LRCLIB_URL);
    expect(url.searchParams.get("track_name")).toBe("River");
    expect(url.searchParams.get("artist_name")).toBe("Someone");
  });

  it("keeps the plain text when LRCLIB has nothing that matches", async () => {
    stubLrclib([[], []]);
    const bag = harness({ ytm: { vid: { lines: UNTIMED, source: "Source: Musixmatch" } } });
    lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, makeVideoDetails());
    expect(shown).toMatchObject({ timed: false, source: "Source: Musixmatch" });
    expect(shown.lines?.map((line) => line.text)).toEqual(VERSE);
  });

  it("never contacts LRCLIB when the toggle is off or the stream is live", async () => {
    const fetchMock = stubLrclib([]);
    const off = harness({ settings: { lrclib: false }, ytm: { vid: { lines: UNTIMED, source: null } } });
    lyricsAddon.activate(off.ctx);
    await play(off, makeVideoDetails());
    const live = harness({ ytm: { vid: { lines: UNTIMED, source: null } } });
    lyricsAddon.activate(live.ctx);
    await play(live, makeVideoDetails({ isLive: true }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("survives a failed lookup and reports no lyrics", async () => {
    stubLrclib([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline")))
    );
    const bag = harness({ ytm: { vid: new Error("innertube down") } });
    lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, makeVideoDetails());
    expect(shown.lines).toBeNull();
  });

  it("drops an answer that arrives after the track changed", async () => {
    vi.useFakeTimers();
    let release: (value: FetchResult) => void = () => {
      return undefined;
    };
    const bag = fakeAddonContext({
      manifest: lyricsAddon.manifest,
      settings: { lrclib: false },
      invokeScript: async (name, arg) => {
        if (name !== "fetch") return true;
        if (isRecord(arg) && arg.videoId === "slow") return new Promise<FetchResult>((resolve) => (release = resolve));
        return { lines: TIMED, source: null };
      },
    });
    lyricsAddon.activate(bag.ctx);
    const emit = (video: VideoDetails) =>
      requireValue(bag.captured.eventListeners.trackChanged).forEach((listener) => listener({ current: video, previous: null }));
    emit(makeVideoDetails({ id: "slow" }));
    emit(makeVideoDetails({ id: "fast" }));
    await bag.waitForInvocation("render", (arg) => isRender(arg) && arg.videoId === "fast" && !arg.pending);
    release({ lines: TIMED, source: null });
    await vi.advanceTimersByTimeAsync(0);
    expect(renders(bag).filter((arg) => arg.videoId === "slow" && !arg.pending)).toEqual([]);
  });

  it("serves a repeat play from the cache and clears it when the LRCLIB toggle flips", async () => {
    stubLrclib([]);
    const bag = harness({ ytm: { vid: { lines: TIMED, source: null } } });
    lyricsAddon.activate(bag.ctx);
    await play(bag, makeVideoDetails());
    await play(bag, makeVideoDetails());
    expect(bag.captured.invocations.filter((call) => call.name === "fetch")).toHaveLength(1);
    expect(renders(bag).filter((arg) => arg.pending)).toHaveLength(1);
    bag.ctx.player.getState = vi.fn(() => makePlayerState({ videoDetails: makeVideoDetails() }));
    requireValue(bag.captured.settingsListeners.lrclib).call(bag.captured.settingsListeners, false, true);
    await bag.waitForInvocation("fetch", () => bag.captured.invocations.filter((call) => call.name === "fetch").length === 2);
    expect(bag.captured.invocations.filter((call) => call.name === "fetch")).toHaveLength(2);
  });

  it("restyles live when the text size changes and lets go on destroy", () => {
    const bag = harness();
    const instance = lyricsAddon.activate(bag.ctx);
    const result = requireValue(bag.ctx.ytmview.insertCSS.mock.results[0]);
    if (result.type !== "return") throw new Error("Expected the CSS handle");
    const handle = result.value;
    requireValue(bag.captured.settingsListeners.textSize).call(bag.captured.settingsListeners, 26, 18);
    expect(handle.update).toHaveBeenCalledWith(lyricsCss(26));
    instance.destroy();
    expect(bag.captured.cssRemoved).toBe(1);
    expect(bag.captured.invocations.at(-1)).toEqual({ name: "render", arg: { disable: true } });
  });
});

describe("lyrics helpers", () => {
  it("only accepts the offered text sizes", () => {
    expect(lyricsCss(26)).toContain("--ytmd-lyrics-font-size: 2.6rem");
    expect(lyricsCss(999)).toContain("--ytmd-lyrics-font-size: 1.8rem");
    expect(lyricsCss(Number.NaN)).toContain("--ytmd-lyrics-font-size: 1.8rem");
  });

  it.each([
    ["3:05", 185],
    ["1:02:03", 3723],
    ["0:59", 59],
    ["", null],
    ["abc", null],
    ["1:2:3:4", null],
    ["-1:00", null],
    [null, null],
    [undefined, null],
    [12, null],
    [["1:23"], 83],
    [{ toString: () => "1:23" }, 83],
  ])("reads the duration %s", (text, seconds) => {
    expect(durationFromText(text)).toBe(seconds);
  });

  it("finds counterparts from either side and filters by length", () => {
    const audio = item("audio", "3:00", [item("video", "3:02"), item("cut", "2:40")]);
    expect(counterpartIds(queue([audio]), makeVideoDetails({ id: "audio", durationSeconds: 180 }))).toEqual(["video"]);
    expect(counterpartIds(queue([audio]), makeVideoDetails({ id: "video", durationSeconds: 182 }))).toEqual(["audio"]);
    expect(counterpartIds(null, makeVideoDetails())).toEqual([]);
  });
});
