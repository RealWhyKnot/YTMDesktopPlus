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
let fetchedUrls: string[];
let resourceEntries: { name: string }[];

function dispatch(type: string) {
  for (const listener of listeners.get(type) ?? []) listener();
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
  nextVideo = vi.fn();
  resourceEntries = [{ name: SEGMENT_URL }];

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
      if (selector === "ytmusic-app-layout>ytmusic-player-bar") return { playerApi: { getVideoData: () => ({ video_id: currentId }), nextVideo } };
      return null;
    }
  };
  globals.performance = { getEntriesByType: () => resourceEntries };
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

  it("posts a directed transition instead of pressing next when a pick is set", async () => {
    run({ transitionIndex: 4 });
    video.currentTime = 180;
    dispatch("timeupdate");
    await flushPrepare();
    video.currentTime = 195.5;
    dispatch("timeupdate");

    expect(shadowSources).toHaveLength(1);
    expect(nextVideo).not.toHaveBeenCalled();
    const post = pageWindow().ytmd.postAddonMessage;
    expect(post).toHaveBeenCalledWith("dj", "transitionNow", { index: 4 });
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

  it("still jumps to the pick when only a plain fade is possible", async () => {
    resourceEntries = [];
    run({ transitionIndex: 2 });
    video.currentTime = 197.5;
    dispatch("timeupdate");
    const post = pageWindow().ytmd.postAddonMessage;
    expect(post).not.toHaveBeenCalled();

    video.currentTime = 199.3;
    dispatch("timeupdate");
    video.currentTime = 199.5;
    dispatch("timeupdate");
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith("dj", "transitionNow", { index: 2 });
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
