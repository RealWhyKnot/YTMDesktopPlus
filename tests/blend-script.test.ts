import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("src/addons/bundled/blend/scripts/blend.script.js", "utf8").trim();
const disableSource = readFileSync("src/addons/bundled/blend/scripts/blend-disable.script.js", "utf8").trim();

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

class FakeAudio {
  volume = 1;
  currentTime = 0;
  paused = true;
  readyState = 0;
  preload = "";
  src = "";
  error: { code: number } | null = null;
  played: number[] = [];
  refusePlay = false;
  private handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  constructor() {
    audios.push(this);
  }
  addEventListener(type: string, listener: (...args: unknown[]) => void) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(listener);
  }
  removeEventListener() {}
  pause() {
    this.paused = true;
  }
  play() {
    if (this.refusePlay) return Promise.reject(new Error("NotAllowedError"));
    this.paused = false;
    this.played.push(this.currentTime);
    return Promise.resolve();
  }
  load() {}
  removeAttribute(name: string) {
    if (name === "src") this.src = "";
  }
  emit(type: string) {
    for (const listener of [...(this.handlers.get(type) ?? [])]) listener();
    if (type === "canplay" || type === "error") this.handlers.delete(type);
  }
  ready() {
    this.readyState = 4;
    this.emit("canplay");
  }
}

let outGain: ReturnType<typeof fakeGainParam>;
let context: { currentTime: number };
let audios: FakeAudio[];
let listeners: Map<string, (() => void)[]>;
let video: {
  paused: boolean;
  muted: boolean;
  readyState: number;
  volume: number;
  currentTime: number;
  duration: number;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};
let nextVideo: ReturnType<typeof vi.fn>;
let currentId: string;
// YTM concatenates tracks into one MediaSource: the element's clock counts
// every track buffered so far, while playerApi stays track-relative. Both are
// zero by default so a test that does not care reads one clock; the timeline
// test sets them to the values measured on the live page.
let priorTracksS: number;
let appendedNextS: number;
// 1 playing, 2 paused by the user, -1 unstarted, 3 buffering.
let playerState: number;
let clockReadable: boolean;
let resourceEntries: { name: string }[];
let perf: { bufferSize: number | null; cleared: number; bufferFull: (() => void)[] };
let nowMs: number;

function dispatch(type: string) {
  for (const listener of [...(listeners.get(type) ?? [])]) listener();
}

function pageWindow() {
  return (globalThis as unknown as { window: Record<string, unknown> & { ytmd: { postAddonMessage: ReturnType<typeof vi.fn> } } }).window;
}

function diags(): Record<string, unknown>[] {
  return pageWindow()
    .ytmd.postAddonMessage.mock.calls.filter(call => call[1] === "diag")
    .map(call => call[2] as Record<string, unknown>);
}

function events() {
  return diags().map(diag => diag.event);
}

function run(config: Record<string, unknown> = {}) {
  return new Function(`return (${source.replace(/;$/, "")})`)()({
    seconds: 5,
    repeatOne: false,
    adPlaying: false,
    hasNext: true,
    ...config
  });
}

function runDisable() {
  return new Function(`return (${disableSource.replace(/;$/, "")})`)()();
}

function armAt(positionS: number) {
  video.currentTime = priorTracksS + positionS;
  dispatch("timeupdate");
  audios.at(-1)?.ready();
}

function changeTrackTo(id: string, lengthS = 200) {
  priorTracksS += video.duration - priorTracksS - appendedNextS;
  appendedNextS = 0;
  video.duration = priorTracksS + lengthS;
  currentId = id;
  video.currentTime = priorTracksS;
}

function advance(ms: number) {
  nowMs += ms;
  vi.advanceTimersByTime(ms);
}

function lastGainValue() {
  return outGain.calls.filter(call => call.method !== "cancel").at(-1);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  listeners = new Map();
  audios = [];
  currentId = "trackA";
  priorTracksS = 0;
  appendedNextS = 0;
  playerState = 1;
  clockReadable = true;
  nowMs = 10_000;
  nextVideo = vi.fn();
  resourceEntries = [{ name: SEGMENT_URL }];
  perf = { bufferSize: null, cleared: 0, bufferFull: [] };
  outGain = fakeGainParam();
  context = { currentTime: 100 };

  video = {
    paused: false,
    muted: false,
    readyState: 4,
    volume: 0.83,
    currentTime: 0,
    duration: 200,
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
  globals.Audio = FakeAudio;
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
            getPlayerState: () => playerState,
            getCurrentTime: () => video.currentTime - priorTracksS,
            // Deliberately the buffered extent, which is what YTM reports and
            // why the engine must not use it: it grows by the next track's
            // length shortly before the change.
            getDuration: () => video.duration - priorTracksS,
            getPlayerResponse: () => (clockReadable ? { videoDetails: { lengthSeconds: String(video.duration - priorTracksS - appendedNextS) } } : undefined),
            nextVideo
          }
        };
      }
      return null;
    }
  };
  globals.performance = {
    now: () => nowMs,
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
});

afterEach(() => {
  vi.useRealTimers();
  const globals = globalThis as Record<string, unknown>;
  delete globals.window;
  delete globals.document;
  delete globals.performance;
  delete globals.Audio;
});

describe("blend script", () => {
  it("reports failure when the page has no audio graph", () => {
    (globalThis as Record<string, unknown>).window = {};
    expect(run()).toBe(false);
  });

  it("attaches once and stays idempotent across re-invocations", () => {
    expect(run()).toBe(true);
    expect(run({ seconds: 8 })).toBe(true);
    expect(listeners.get("timeupdate")).toHaveLength(1);
  });

  it("keeps the resource timing buffer large enough to survive a long session", () => {
    run();
    expect(perf.bufferSize).toBe(1000);
    perf.bufferFull[0]();
    expect(perf.cleared).toBe(1);
  });

  it("arms a silent shadow from a stripped segment URL, in step with the track", () => {
    run();
    armAt(30);
    expect(audios).toHaveLength(1);
    const url = new URL(audios[0].src);
    for (const param of ["range", "rn", "ump", "rbuf", "srfvp", "alr"]) expect(url.searchParams.has(param)).toBe(false);
    expect(url.searchParams.get("itag")).toBe("141");
    expect(audios[0].volume).toBe(0);
    expect(audios[0].currentTime).toBe(30);
    expect(audios[0].paused).toBe(false);
    expect(events()).toContain("armed");
  });

  it("corrects shadow drift while it is silent, and never during a blend", () => {
    run();
    armAt(30);
    audios[0].currentTime = 30.5;
    video.currentTime = 31;
    dispatch("timeupdate");
    expect(audios[0].currentTime).toBe(31);

    armAt(195.5);
    audios[0].currentTime = 100;
    video.currentTime = 196;
    dispatch("timeupdate");
    expect(audios[0].currentTime).toBe(100);
  });

  it("blends at the end: shadow up to the ear level, out gain to zero, player advanced", () => {
    run();
    armAt(30);
    armAt(195.5);

    expect(audios).toHaveLength(1);
    expect(audios[0].volume).toBe(0.83);
    expect(lastGainValue()).toMatchObject({ method: "target", value: 0 });
    expect(nextVideo).toHaveBeenCalledTimes(1);
    expect(diags().find(diag => diag.event === "blend")).toMatchObject({ kind: "end", seconds: 5 });
  });

  // Measured on the live page: YTM appends the next track into the same
  // MediaSource ~10s before the current one ends. The element then reported
  // duration 161 for a track ending at 112.4, and playerApi.getDuration()
  // jumped 183.62 -> 199.91 on a track whose lengthSeconds stayed 184. Timing
  // off either one misses the window by whatever has been appended.
  it("blends on the track length, not the element clock or the buffered extent", () => {
    priorTracksS = 112.33;
    appendedNextS = 49;
    video.duration = priorTracksS + 200 + appendedNextS;

    run();
    armAt(30);
    armAt(194);
    expect(nextVideo).not.toHaveBeenCalled();

    armAt(195.5);
    expect(nextVideo).toHaveBeenCalledTimes(1);
  });

  it("blends a manual skip off the shadow already playing, without advancing again", () => {
    run();
    armAt(30);

    changeTrackTo("trackB");
    dispatch("timeupdate");

    expect(audios).toHaveLength(1);
    expect(audios[0].volume).toBe(0.83);
    expect(nextVideo).not.toHaveBeenCalled();
    expect(diags().find(diag => diag.event === "blend")).toMatchObject({ kind: "skip" });
  });

  it("fades the incoming track in while a skip blend is still running", () => {
    run();
    armAt(30);

    changeTrackTo("trackB");
    dispatch("timeupdate");

    advance(1000);
    dispatch("timeupdate");

    const curve = outGain.calls.filter(call => call.method === "curve").at(-1);
    expect(curve).toBeDefined();
    expect(curve!.duration).toBeCloseTo(4, 1);
  });

  it("does not lift the gain before our own advance has landed", () => {
    run();
    armAt(30);
    armAt(195.5);

    advance(1000);
    dispatch("timeupdate");
    expect(outGain.calls.some(call => call.method === "curve")).toBe(false);
  });

  it("stands down when the shadow loaded but was never allowed to play", () => {
    run();
    armAt(30);
    audios[0].refusePlay = true;
    audios[0].paused = true;

    armAt(195.5);
    expect(nextVideo).not.toHaveBeenCalled();
    expect(diags().find(diag => diag.event === "suppressed")).toMatchObject({ reason: "shadow not ready" });
  });

  it("blends a skip before the incoming track reports its length", () => {
    run();
    armAt(30);

    clockReadable = false;
    changeTrackTo("trackB");
    dispatch("timeupdate");

    expect(audios[0].volume).toBe(0.83);
    expect(diags().find(diag => diag.event === "blend")).toMatchObject({ kind: "skip" });
  });

  it("cuts rather than blends a skip taken before the shadow is ready", () => {
    run();
    video.currentTime = 2;
    dispatch("timeupdate");

    changeTrackTo("trackB");
    dispatch("timeupdate");
    expect(diags().find(diag => diag.event === "cut")).toBeDefined();
    expect(events()).not.toContain("blend");
  });

  it("ramps the shadow down on an equal power curve and releases it at the end", () => {
    run();
    armAt(30);
    armAt(195.5);
    const shadow = audios[0];

    advance(2500);
    expect(shadow.volume).toBeCloseTo(0.83 * Math.cos(Math.PI / 4), 3);

    advance(2600);
    expect(shadow.src).toBe("");
    expect(events()).toContain("done");
  });

  it("fades the incoming track in over what is left of the shadow ramp", () => {
    run();
    armAt(30);
    armAt(195.5);

    advance(3000);
    changeTrackTo("trackB");
    dispatch("timeupdate");

    const curve = outGain.calls.filter(call => call.method === "curve").at(-1);
    expect(curve).toBeDefined();
    expect(curve!.duration).toBeCloseTo(2, 1);
    expect((curve!.value as Float32Array)[0]).toBeCloseTo(0, 5);
    expect((curve!.value as Float32Array).at(-1)).toBeCloseTo(1, 5);
  });

  describe("reading how loud the track actually is", () => {
    it("goes through the native descriptor, past the volume ratio patch", () => {
      pageWindow().HTMLMediaElement_volume = { get: () => 0.42 };
      video.volume = 0.93;
      run();
      armAt(30);
      armAt(195.5);
      expect(audios[0].volume).toBe(0.42);
    });

    it("opens the shadow silent when the player is muted", () => {
      video.muted = true;
      run();
      armAt(30);
      armAt(195.5);
      expect(audios[0].volume).toBe(0);
    });

    it("silences the shadow if the player is muted mid blend", () => {
      run();
      armAt(30);
      armAt(195.5);
      expect(audios[0].volume).toBe(0.83);
      video.muted = true;
      dispatch("volumechange");
      expect(audios[0].volume).toBe(0);
    });

    it("uses the room capture level, and still blends, while a broadcast is live", () => {
      pageWindow().__ytmdAudioStream = { stopped: false, effectiveVolume: () => 0.27 };
      video.volume = 1;
      run();
      armAt(30);
      armAt(195.5);
      expect(audios[0].volume).toBe(0.27);
      expect(nextVideo).toHaveBeenCalledTimes(1);
    });

    it("falls back to the element when a half torn down capture throws", () => {
      pageWindow().__ytmdAudioStream = {
        stopped: false,
        effectiveVolume: () => {
          throw new Error("capture context closed");
        }
      };
      run();
      armAt(30);
      armAt(195.5);
      expect(audios[0].volume).toBe(0.83);
      expect(nextVideo).toHaveBeenCalledTimes(1);
    });

    it("ignores a capture that has already stopped", () => {
      pageWindow().__ytmdAudioStream = { stopped: true, effectiveVolume: () => 0.27 };
      run();
      armAt(30);
      armAt(195.5);
      expect(audios[0].volume).toBe(0.83);
    });
  });

  describe("suppression", () => {
    it.each([
      ["ad playing", { adPlaying: true }],
      ["repeat one", { repeatOne: true }],
      ["no next track", { hasNext: false }]
    ])("stands down for %s", (reason, config) => {
      run(config);
      armAt(30);
      armAt(195.5);
      expect(nextVideo).not.toHaveBeenCalled();
      expect(diags().find(diag => diag.event === "suppressed")).toMatchObject({ reason });
    });

    it("stands down when the track clock is unreadable", () => {
      (globalThis as Record<string, unknown>).document = {
        querySelector: (selector: string) => (selector === "video" ? video : null)
      };
      run();
      video.currentTime = 195.5;
      dispatch("timeupdate");
      expect(nextVideo).not.toHaveBeenCalled();
    });

    it("has no other reason to stand down", () => {
      run();
      armAt(30);
      armAt(195.5);
      expect(events()).not.toContain("suppressed");
      expect(nextVideo).toHaveBeenCalledTimes(1);
    });
  });

  describe("guards", () => {
    it("survives the pause and seek that advancing causes", () => {
      run();
      armAt(30);
      armAt(195.5);

      playerState = 3;
      dispatch("pause");
      dispatch("seeking");
      expect(events()).not.toContain("aborted");
      expect(lastGainValue()).toMatchObject({ value: 0 });
    });

    it("gives the volume back when the user really pauses", () => {
      run();
      armAt(30);
      armAt(195.5);

      playerState = 2;
      dispatch("pause");
      expect(diags().find(diag => diag.event === "aborted")).toMatchObject({ reason: "paused" });
      expect(lastGainValue()).toMatchObject({ value: 1 });
    });

    it("writes the gain back directly when nothing lifts it", () => {
      run();
      armAt(30);
      armAt(195.5);
      expect(outGain.value).toBe(1);

      advance(18_100);
      expect(outGain.value).toBe(1);
      expect(events()).toContain("silenceRecovered");
    });

    it("does not fire the watchdog once the incoming track has faded in", () => {
      run();
      armAt(30);
      armAt(195.5);
      changeTrackTo("trackB");
      dispatch("timeupdate");

      advance(18_100);
      expect(events()).not.toContain("silenceRecovered");
    });
  });

  it("detaches everything on disable", () => {
    run();
    armAt(30);
    armAt(195.5);
    expect(runDisable()).toBe(true);
    expect(pageWindow().__ytmdBlend).toBeUndefined();
    expect(listeners.get("timeupdate")).toHaveLength(0);
    expect(audios[0].src).toBe("");
    expect(lastGainValue()).toMatchObject({ value: 1 });
  });
});
