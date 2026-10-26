import { afterEach, describe, expect, it, vi } from "vitest";

import lyricsAddon, { LRCLIB_URL, counterpartIds, durationFromText, lyricsCss } from "../src/addons/bundled/lyrics";
import { fakeAddonContext, makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";
import { RepeatMode, type AddonInstance, type PlayerQueue, type PlayerQueueItem, type VideoDetails } from "../src/shared/addons/sdk";

const VERSE = ["I walked along the river", "the water running cold", "you said the night was ours", "and never let it go", "we sang until the morning"];
const TIMED = VERSE.map((line, index) => ({
  lyricLine: line,
  cueRange: { startTimeMilliseconds: String(1000 + index * 3000), endTimeMilliseconds: String(4000 + index * 3000) }
}));
const UNTIMED = VERSE.map(line => ({ lyricLine: line }));
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
    invokeScript: async (name, arg) => {
      if (name !== "fetch") return true;
      const answer = options.ytm?.[(arg as { videoId: string }).videoId] ?? null;
      if (answer instanceof Error) throw answer;
      return answer;
    }
  });
  bag.ctx.player.getQueue = vi.fn(() => options.queue ?? null);
  return bag;
}

async function play(bag: ReturnType<typeof harness>, video: VideoDetails) {
  for (const listener of bag.captured.eventListeners.trackChanged ?? []) listener({ current: video, previous: null });
  await vi.waitFor(() => expect(renders(bag).some(arg => arg.videoId === video.id && !arg.pending)).toBe(true));
  return renders(bag)
    .filter(arg => arg.videoId === video.id && !arg.pending)
    .at(-1)!;
}

function renders(bag: ReturnType<typeof harness>) {
  return bag.captured.invocations
    .filter(call => call.name === "render")
    .map(
      call =>
        call.arg as { videoId: string; pending?: boolean; lines: { text: string; start: number | null }[] | null; timed?: boolean; source?: string | null }
    );
}

function stubLrclib(responses: unknown[][]) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => responses.shift() ?? [] }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("lyrics bundled addon", () => {
  it("ships on, with the size picker and the LRCLIB toggle", async () => {
    const bag = harness();
    await lyricsAddon.activate(bag.ctx);
    expect(lyricsAddon.manifest.defaultEnabled).toBe(true);
    expect(bag.captured.sections.flatMap(section => section.fields).map(field => field.key)).toEqual(["textSize", "lrclib"]);
    expect(Object.keys(bag.captured.scripts)).toEqual(["fetch", "render"]);
    expect(bag.ctx.ytmview.insertCSS).toHaveBeenCalledWith(lyricsCss(18));
  });

  it("uses YouTube Music's own timed lyrics and never calls LRCLIB for them", async () => {
    const fetchMock = stubLrclib([]);
    const bag = harness({ ytm: { vid: { lines: TIMED, source: "Source: Musixmatch" } } });
    await lyricsAddon.activate(bag.ctx);
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
      queue: queue([item("vid", "3:00", [item("long", "3:30"), item("video2", "3:01")])])
    });
    await lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, makeVideoDetails());
    expect(shown).toMatchObject({ timed: true, source: "b" });
    expect(bag.captured.invocations.filter(call => call.name === "fetch").map(call => (call.arg as { videoId: string }).videoId)).toEqual(["vid", "video2"]);
  });

  it("falls back to LRCLIB when YouTube Music has only plain text", async () => {
    const fetchMock = stubLrclib([[{ id: 1, trackName: "River", artistName: "Someone", duration: 180, syncedLyrics: SYNCED }]]);
    const bag = harness({ ytm: { vid: { lines: UNTIMED, source: "Source: Musixmatch" } } });
    await lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, makeVideoDetails({ title: "River (Official Video)", author: "Someone - Topic" }));
    expect(shown).toMatchObject({ timed: true, source: "Source: LRCLIB" });
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.origin + url.pathname).toBe(LRCLIB_URL);
    expect(url.searchParams.get("track_name")).toBe("River");
    expect(url.searchParams.get("artist_name")).toBe("Someone");
  });

  it("keeps the plain text when LRCLIB has nothing that matches", async () => {
    stubLrclib([[], []]);
    const bag = harness({ ytm: { vid: { lines: UNTIMED, source: "Source: Musixmatch" } } });
    await lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, makeVideoDetails());
    expect(shown).toMatchObject({ timed: false, source: "Source: Musixmatch" });
    expect(shown.lines?.map(line => line.text)).toEqual(VERSE);
  });

  it("never contacts LRCLIB when the toggle is off or the stream is live", async () => {
    const fetchMock = stubLrclib([]);
    const off = harness({ settings: { lrclib: false }, ytm: { vid: { lines: UNTIMED, source: null } } });
    await lyricsAddon.activate(off.ctx);
    await play(off, makeVideoDetails());
    const live = harness({ ytm: { vid: { lines: UNTIMED, source: null } } });
    await lyricsAddon.activate(live.ctx);
    await play(live, makeVideoDetails({ isLive: true }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("survives a failed lookup and reports no lyrics", async () => {
    stubLrclib([]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      })
    );
    const bag = harness({ ytm: { vid: new Error("innertube down") } });
    await lyricsAddon.activate(bag.ctx);
    const shown = await play(bag, makeVideoDetails());
    expect(shown.lines).toBeNull();
  });

  it("drops an answer that arrives after the track changed", async () => {
    let release: (value: FetchResult) => void = () => {};
    const bag = fakeAddonContext({
      manifest: lyricsAddon.manifest,
      settings: { lrclib: false },
      invokeScript: async (name, arg) => {
        if (name !== "fetch") return true;
        if ((arg as { videoId: string }).videoId === "slow") return new Promise<FetchResult>(resolve => (release = resolve));
        return { lines: TIMED, source: null };
      }
    });
    await lyricsAddon.activate(bag.ctx);
    const emit = (video: VideoDetails) => bag.captured.eventListeners.trackChanged.forEach(listener => listener({ current: video, previous: null }));
    emit(makeVideoDetails({ id: "slow" }));
    emit(makeVideoDetails({ id: "fast" }));
    await vi.waitFor(() => expect(renders(bag as never).some(arg => arg.videoId === "fast" && !arg.pending)).toBe(true));
    release({ lines: TIMED, source: null });
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(renders(bag as never).filter(arg => arg.videoId === "slow" && !arg.pending)).toEqual([]);
  });

  it("serves a repeat play from the cache and clears it when the LRCLIB toggle flips", async () => {
    stubLrclib([]);
    const bag = harness({ ytm: { vid: { lines: TIMED, source: null } } });
    await lyricsAddon.activate(bag.ctx);
    await play(bag, makeVideoDetails());
    await play(bag, makeVideoDetails());
    expect(bag.captured.invocations.filter(call => call.name === "fetch")).toHaveLength(1);
    expect(renders(bag).filter(arg => arg.pending)).toHaveLength(1);
    bag.ctx.player.getState = vi.fn(() => makePlayerState({ videoDetails: makeVideoDetails() }));
    bag.captured.settingsListeners.lrclib(false, true);
    await vi.waitFor(() => expect(bag.captured.invocations.filter(call => call.name === "fetch")).toHaveLength(2));
  });

  it("restyles live when the text size changes and lets go on destroy", async () => {
    const bag = harness();
    const instance = await lyricsAddon.activate(bag.ctx);
    const handle = vi.mocked(bag.ctx.ytmview.insertCSS).mock.results[0].value;
    bag.captured.settingsListeners.textSize(26, 18);
    expect(handle.update).toHaveBeenCalledWith(lyricsCss(26));
    (instance as AddonInstance | undefined)?.destroy?.();
    expect(bag.captured.cssRemoved).toBe(1);
    expect(bag.captured.invocations.at(-1)).toEqual({ name: "render", arg: { disable: true } });
  });
});

describe("lyrics helpers", () => {
  it("only accepts the offered text sizes", () => {
    expect(lyricsCss(26)).toContain("font-size: 26px");
    expect(lyricsCss(999)).toContain("font-size: 18px");
    expect(lyricsCss(Number.NaN)).toContain("font-size: 18px");
  });

  it.each([
    ["3:05", 185],
    ["1:02:03", 3723],
    ["0:59", 59],
    ["", null],
    ["abc", null],
    ["1:2:3:4", null],
    ["-1:00", null]
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
