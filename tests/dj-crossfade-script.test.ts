import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The crossfade engine runs in YTM's main world, so it is exercised against
// the smallest stand-in exposing what it touches: the shared audio graph, the
// video element, the player bar and the segment URLs in resource timing. The
// defects it is most likely to grow are audible ones: a fade that never
// restores, an overlap that double-plays, a transition that survives a pause.

const source = readFileSync("src/addons/bundled/dj/scripts/crossfade.script.js", "utf8").trim();
const disableSource = readFileSync("src/addons/bundled/dj/scripts/crossfade-disable.script.js", "utf8").trim();

const SAMPLE_RATE = 48000;
const SEGMENT_URL = "https://rr1.googlevideo.com/videoplayback?itag=141&mime=audio%2Fmp4&range=0-9999&rn=5&ump=1&pot=abc&sig=xyz";

type GainRecord = { method: string; value?: number | Float32Array; time?: number; duration?: number };

function fakeGainParam() {
  const calls: GainRecord[] = [];
  return {
    value: 1,
    calls,
    cancelScheduledValues: vi.fn((time: number) => calls.push({ method: "cancel", time })),
    setValueAtTime: vi.fn((value: number, time: number) => calls.push({ method: "set", value, time })),
    setTargetAtTime: vi.fn((value: number, time: number, duration: number) => calls.push({ method: "target", value, time, duration })),
    setValueCurveAtTime: vi.fn((value: Float32Array, time: number, duration: number) => calls.push({ method: "curve", value, time, duration }))
  };
}

function fakeAudioBuffer(seconds: number) {
  return {
    duration: seconds,
    length: Math.floor(seconds * SAMPLE_RATE),
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 2,
    getChannelData: () => new Float32Array(Math.floor(seconds * SAMPLE_RATE)),
    copyToChannel: vi.fn()
  };
}

let outGain: ReturnType<typeof fakeGainParam>;
let context: {
  currentTime: number;
  destination: object;
  createGain: ReturnType<typeof vi.fn>;
  createBufferSource: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  decodeAudioData: ReturnType<typeof vi.fn>;
};
let video: {
  currentTime: number;
  duration: number;
  paused: boolean;
  muted: boolean;
  readyState: number;
  playbackRate: number;
  preservesPitch: boolean;
  volume: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
let listeners: Map<string, (() => void)[]>;
let shadowGains: ReturnType<typeof fakeGainParam>[];
let shadowSources: {
  buffer: unknown;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}[];
let nextVideo: ReturnType<typeof vi.fn>;
let currentId: string;
// YTM concatenates tracks into one MediaSource: the element's clock counts
// every track buffered so far, while playerApi stays track-relative. Both are
// zero by default so a test that does not care reads one clock; the timeline
// test below sets them to the values measured on the live page.
let priorTracksS: number;
let appendedNextS: number;
let fetchedUrls: string[];
let resourceEntries: { name: string }[];
let perf: { bufferSize: number | null; cleared: number; bufferFull: (() => void)[] };

function dispatch(type: string) {
  for (const listener of listeners.get(type) ?? []) listener();
}

// Diagnostic reports the page pushes to the main process, in order.
function diags(): Record<string, unknown>[] {
  return pageWindow()
    .ytmd.postAddonMessage.mock.calls.filter(call => call[1] === "diag")
    .map(call => call[2] as Record<string, unknown>);
}

// The stand-in window replaces the lib.dom Window for these tests.
function pageWindow() {
  return (globalThis as unknown as { window: { ytmd: { postAddonMessage: ReturnType<typeof vi.fn> }; __ytmdDjCrossfade?: unknown } }).window;
}

function run(config: Record<string, unknown> = {}) {
  return new Function(`return (${source.replace(/;$/, "")})`)()({
    enabled: true,
    fadeOutS: 5,
    fadeInS: 1.5,
    curve: 0,
    fadeOnManualSkip: true,
    fadeOnRepeatOne: false,
    repeatOne: false,
    adPlaying: false,
    hasNext: true,
    ...config
  });
}

function runDisable() {
  return new Function(`return (${disableSource.replace(/;$/, "")})`)()();
}

async function flushPrepare() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function lastGainValue() {
  const relevant = outGain.calls.filter(call => call.method !== "cancel");
  return relevant.at(-1);
}

beforeEach(() => {
  listeners = new Map();
  shadowGains = [];
  shadowSources = [];
  fetchedUrls = [];
  currentId = "trackA";
  priorTracksS = 0;
  appendedNextS = 0;
  nextVideo = vi.fn();
  resourceEntries = [{ name: SEGMENT_URL }];
  perf = { bufferSize: null, cleared: 0, bufferFull: [] };

  outGain = fakeGainParam();
  context = {
    currentTime: 100,
    destination: {},
    createGain: vi.fn(() => {
      const gain = fakeGainParam();
      shadowGains.push(gain);
      return { gain, connect: vi.fn(), disconnect: vi.fn() };
    }),
    createBufferSource: vi.fn(() => {
      const sourceNode = {
        buffer: null as unknown,
        start: vi.fn(),
        stop: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null as (() => void) | null
      };
      shadowSources.push(sourceNode);
      return sourceNode;
    }),
    createBuffer: vi.fn((channels: number, frames: number) => fakeAudioBuffer(frames / SAMPLE_RATE)),
    decodeAudioData: vi.fn(async () => fakeAudioBuffer(200))
  };

  video = {
    currentTime: 0,
    duration: 200,
    paused: false,
    muted: false,
    readyState: 4,
    playbackRate: 1,
    preservesPitch: false,
    volume: 0.83,
    addEventListener: (type, listener) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type)!.push(listener);
    },
    removeEventListener: (type, listener) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter(entry => entry !== listener)
      );
    }
  };

  const globals = globalThis as Record<string, unknown>;
  globals.window = {
    __ytmdEnsureAudioGraph: () => ({ context, source: {}, out: { gain: outGain } }),
    ytmd: { postAddonMessage: vi.fn() }
  };
  globals.document = {
    querySelector: (selector: string) => {
      if (selector === "video") return video;
      if (selector === "ytmusic-app-layout>ytmusic-player-bar") {
        return {
          playerApi: {
            getVideoData: () => ({ video_id: currentId }),
            getCurrentTime: () => video.currentTime - priorTracksS,
            // Deliberately the buffered extent, which is what YTM reports and
            // why the engine must not use it: it grows by the next track's
            // length shortly before the change.
            getDuration: () => video.duration - priorTracksS,
            getPlayerResponse: () => ({ videoDetails: { lengthSeconds: String(video.duration - priorTracksS - appendedNextS) } }),
            nextVideo
          }
        };
      }
      return null;
    }
  };
  globals.performance = {
    getEntriesByType: () => resourceEntries,
    setResourceTimingBufferSize: (size: number) => {
      perf.bufferSize = size;
    },
    clearResourceTimings: () => {
      perf.cleared++;
      resourceEntries = [];
    },
    addEventListener: (type: string, listener: () => void) => {
      if (type === "resourcetimingbufferfull") perf.bufferFull.push(listener);
    }
  };
  globals.fetch = vi.fn(async (url: string) => {
    fetchedUrls.push(url);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  });
});

afterEach(() => {
  const globals = globalThis as Record<string, unknown>;
  delete globals.window;
  delete globals.document;
  delete globals.performance;
  delete globals.fetch;
});

describe("dj crossfade script", () => {
  it("reports failure when the page has no audio graph", () => {
    (globalThis as Record<string, unknown>).window = {};
    expect(run()).toBe(false);
  });

  it("attaches once and stays idempotent across re-invocations", () => {
    expect(run()).toBe(true);
    expect(run({ fadeOutS: 8 })).toBe(true);
    expect(listeners.get("timeupdate")).toHaveLength(1);
  });

  it("prepares the tail from a stripped segment URL inside the lead window", async () => {
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    expect(fetchedUrls).toHaveLength(1);
    const url = new URL(fetchedUrls[0]);
    for (const param of ["range", "rn", "ump"]) expect(url.searchParams.has(param)).toBe(false);
    expect(url.searchParams.get("itag")).toBe("141");
  });

  it("starts the overlap: shadow tail at element volume, out gain to zero, skip ahead", async () => {
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();

    video.currentTime = 195.5;
    dispatch("timeupdate");

    expect(shadowSources).toHaveLength(1);
    expect(shadowSources[0].start).toHaveBeenCalled();
    expect(shadowGains[0].calls.some(call => call.method === "curve")).toBe(true);
    expect(shadowGains[0].value).toBe(0.83);
    expect(lastGainValue()).toMatchObject({ method: "target", value: 0 });
    expect(nextVideo).toHaveBeenCalledTimes(1);
  });

  // Measured on the live page: YTM appends the next track into the same
  // MediaSource ~10s before the current one ends. The element then reported
  // duration 161 for a track ending at 112.4, and playerApi.getDuration()
  // jumped 183.62 -> 199.91 on a track whose lengthSeconds stayed 184. Timing
  // off either one misses the fade window by whatever has been appended.
  it("fades on the track length, not the element or the buffered extent", async () => {
    priorTracksS = 112.33;
    appendedNextS = 49;
    video.duration = priorTracksS + 200 + appendedNextS;

    run();
    video.currentTime = priorTracksS + 180;
    dispatch("timeupdate");
    await flushPrepare();
    expect(fetchedUrls).toHaveLength(1);

    video.currentTime = priorTracksS + 195.5;
    dispatch("timeupdate");

    expect(shadowSources).toHaveLength(1);
    expect(diags().some(entry => entry.event === "overlap")).toBe(true);
    // Offset into the decoded tail is track-relative too: 195.5 into a 200s
    // track whose tail starts at 200 - 5 - 2.
    expect(shadowSources[0].start).toHaveBeenCalledWith(expect.any(Number), 2.5);
  });

  it("stands down when the track clock is unreadable", () => {
    run();
    video.currentTime = 195.5;
    video.duration = Number.NaN;
    dispatch("timeupdate");

    expect(shadowSources).toHaveLength(0);
    expect(diags().some(entry => entry.event === "suppressed" && entry.reason === "no track clock")).toBe(true);
  });

  it("fades the incoming track in from silence once it plays", async () => {
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");

    currentId = "trackB";
    video.currentTime = 0.5;
    video.duration = 180;
    dispatch("timeupdate");

    const curve = outGain.calls.filter(call => call.method === "curve").at(-1);
    expect(curve).toBeDefined();
    expect((curve!.value as Float32Array)[0]).toBe(0);
    expect((curve!.value as Float32Array).at(-1)).toBeCloseTo(1);
    expect(curve!.duration).toBe(1.5);
  });

  it("keeps the shadow silent while the element is muted", async () => {
    run();
    video.muted = true;
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");
    expect(shadowSources).toHaveLength(1);
    expect(shadowGains[0].value).toBe(0);
  });

  it("kills the shadow when the element is muted mid-overlap", async () => {
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");
    expect(shadowGains[0].value).toBe(0.83);

    video.muted = true;
    dispatch("volumechange");
    expect(shadowSources[0].stop).toHaveBeenCalled();
  });

  it("aborts the overlap on pause: shadow stops and the gain comes back", async () => {
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");

    dispatch("pause");
    expect(shadowSources[0].stop).toHaveBeenCalled();
    expect(lastGainValue()).toMatchObject({ method: "target", value: 1 });
  });

  it("lifts the gain itself when nothing ever arrives to lift it", async () => {
    vi.useFakeTimers();
    try {
      resourceEntries = [];
      run();
      video.currentTime = 197.5;
      dispatch("timeupdate");
      // The page went quiet mid-fade: no pause, no playing, no further ticks.
      outGain.value = 0;

      await vi.advanceTimersByTimeAsync(5000 + 1500 + 8000);
      expect(outGain.value).toBe(1);
      expect(diags().at(-1)).toMatchObject({ event: "silenceRecovered" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("never leaves the app silent when the incoming track never starts", async () => {
    resourceEntries = [];
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();

    // Faded out on the plain path, then playback stops without the next track
    // ever reaching a timeupdate that could lift the gain again.
    video.currentTime = 199;
    dispatch("timeupdate");
    expect(lastGainValue()?.value).toBeLessThan(1);

    video.paused = true;
    dispatch("pause");
    expect(lastGainValue()).toMatchObject({ method: "target", value: 1 });
  });

  it("falls back to a plain fade when the tail could not be recovered", async () => {
    resourceEntries = [];
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();

    video.currentTime = 197.5;
    dispatch("timeupdate");
    expect(shadowSources).toHaveLength(0);
    expect(nextVideo).not.toHaveBeenCalled();
    const fade = lastGainValue();
    expect(fade?.method).toBe("target");
    expect(fade?.value).toBeLessThan(1);
    expect(fade?.value).toBeGreaterThan(0);
  });

  it("plain-fades instead of overlapping when nothing comes next", async () => {
    run({ hasNext: false });
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");
    expect(shadowSources).toHaveLength(0);
    expect(nextVideo).not.toHaveBeenCalled();
  });

  it("restores the gain when a seek leaves the fade window", async () => {
    resourceEntries = [];
    run();
    video.currentTime = 197.5;
    dispatch("timeupdate");
    expect(lastGainValue()?.value).toBeLessThan(1);

    video.currentTime = 30;
    dispatch("timeupdate");
    const restored = lastGainValue();
    const level = restored?.method === "curve" ? (restored.value as Float32Array).at(-1) : restored?.value;
    expect(level).toBeCloseTo(1);
  });

  it("stays quiet on repeat-one unless asked to fade there too", () => {
    run({ repeatOne: true });
    video.currentTime = 197.5;
    dispatch("timeupdate");
    expect(outGain.calls.filter(call => call.method !== "cancel")).toHaveLength(0);
  });

  it("does nothing while an ad is playing", () => {
    run({ adPlaying: true });
    video.currentTime = 197.5;
    dispatch("timeupdate");
    expect(shadowSources).toHaveLength(0);
    expect(outGain.calls.filter(call => call.method === "curve")).toHaveLength(0);
  });

  it("pins the incoming track to silence on manual skips when asked", () => {
    run();
    dispatch("loadstart");
    expect(lastGainValue()).toMatchObject({ method: "set", value: 0 });
    dispatch("playing");
    const curve = outGain.calls.filter(call => call.method === "curve").at(-1);
    expect(curve).toBeDefined();
  });

  it("recovers a gain pinned silent when the playing event was missed", () => {
    run();
    dispatch("loadstart");
    expect(lastGainValue()).toMatchObject({ method: "set", value: 0 });

    video.currentTime = 42;
    dispatch("timeupdate");
    const curve = outGain.calls.filter(call => call.method === "curve").at(-1);
    expect(curve).toBeDefined();
    expect((curve!.value as Float32Array).at(-1)).toBeCloseTo(1);
  });

  it("leaves manual skips alone when the toggle is off", () => {
    run({ fadeOnManualSkip: false });
    dispatch("loadstart");
    expect(outGain.calls.filter(call => call.method !== "cancel")).toHaveLength(0);
  });

  it("snaps the fade start back onto the pushed beat grid", async () => {
    run({ beatOffsetS: 0.25, beatPeriodS: 0.5 });
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();

    // Grid puts the fade start at 194.75; just before it nothing happens.
    video.currentTime = 194.5;
    dispatch("timeupdate");
    expect(shadowSources).toHaveLength(0);

    video.currentTime = 194.8;
    dispatch("timeupdate");
    expect(shadowSources).toHaveLength(1);
  });

  it("reports an overlap once, however many ticks the fade spans", async () => {
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();

    video.currentTime = 195.5;
    dispatch("timeupdate");
    video.currentTime = 196;
    dispatch("timeupdate");

    expect(diags()).toEqual([
      { event: "prepReady", videoId: "trackA", tailS: expect.any(Number) },
      { event: "overlap", videoId: "trackA", fadeS: 5 }
    ]);
  });

  it("names the reason when a transition degrades to a plain fade", async () => {
    resourceEntries = [];
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");

    expect(diags().filter(entry => entry.event === "prepFailed")).toEqual([
      { event: "prepFailed", videoId: "trackA", attempt: 1, reason: "no audio segment urls" }
    ]);
    expect(diags().at(-1)).toEqual({ event: "plainFade", videoId: "trackA", reason: "tail unavailable" });
  });

  it("distinguishes a missing next track from a room capture", async () => {
    run({ hasNext: false });
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");
    expect(diags().at(-1)).toEqual({ event: "plainFade", videoId: "trackA", reason: "no next track" });

    runDisable();
    (globalThis as unknown as { window: Record<string, unknown> }).window.__ytmdAudioStream = {};
    pageWindow().ytmd.postAddonMessage.mockClear();
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");
    expect(diags().at(-1)).toEqual({ event: "plainFade", videoId: "trackA", reason: "room capture active" });
  });

  it("reports a suppressing state only once it outlives the opening seconds", () => {
    run({ adPlaying: true });
    video.currentTime = 3;
    dispatch("timeupdate");
    expect(diags()).toEqual([]);

    video.currentTime = 6;
    dispatch("timeupdate");
    video.currentTime = 7;
    dispatch("timeupdate");
    expect(diags()).toEqual([{ event: "suppressed", videoId: "trackA", reason: "ad playing" }]);
  });

  it("retries a failed tail prepare inside the prep window, then gives up", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    resourceEntries = [];
    run();

    for (let attempt = 1; attempt <= 4; attempt++) {
      now.mockReturnValue(attempt * 5000);
      video.currentTime = 180 + attempt;
      dispatch("timeupdate");
      await flushPrepare();
    }

    expect(
      diags()
        .filter(entry => entry.event === "prepFailed")
        .map(entry => entry.attempt)
    ).toEqual([1, 2, 3]);
    now.mockRestore();
  });

  it("keeps resource timing recording on a long-lived page", () => {
    run();
    expect(perf.bufferSize).toBe(1000);
    expect(perf.bufferFull).toHaveLength(1);

    perf.bufferFull[0]();
    expect(perf.cleared).toBe(1);

    // Re-invoking on every track change must not stack another listener.
    run();
    expect(perf.bufferFull).toHaveLength(1);
  });

  it("tempo-matches the incoming track and glides back to natural speed", () => {
    run({ incomingRate: 1.05, rateGlideS: 1 });
    dispatch("loadstart");
    dispatch("playing");
    expect(video.playbackRate).toBeCloseTo(1.05);
    expect(video.preservesPitch).toBe(true);

    video.currentTime = 30;
    dispatch("timeupdate");
    expect(video.playbackRate).toBeLessThan(1.05);
    for (let i = 0; i < 10; i++) dispatch("timeupdate");
    expect(video.playbackRate).toBe(1);
  });

  it("resets the rate the moment the track changes mid-glide", () => {
    run({ incomingRate: 1.05 });
    dispatch("loadstart");
    dispatch("playing");
    expect(video.playbackRate).toBeCloseTo(1.05);

    currentId = "trackB";
    dispatch("timeupdate");
    expect(video.playbackRate).toBe(1);
  });

  it("leaves an externally changed rate alone", () => {
    run({ incomingRate: 1.05 });
    video.playbackRate = 1.5;
    dispatch("loadstart");
    dispatch("playing");
    expect(video.playbackRate).toBe(1.5);
  });

  it("tears down cleanly: listeners gone, gain restored, global dropped", async () => {
    run();
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");

    expect(runDisable()).toBe(true);
    expect(shadowSources[0].stop).toHaveBeenCalled();
    expect(lastGainValue()).toMatchObject({ method: "target", value: 1 });
    expect(listeners.get("timeupdate")).toHaveLength(0);
    expect(pageWindow().__ytmdDjCrossfade).toBeUndefined();
  });
});
