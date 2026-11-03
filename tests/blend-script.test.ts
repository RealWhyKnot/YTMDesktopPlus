import { readPageScript, runPageScript } from "./helpers/page-script";
import { requireValue, requireRecord } from "./helpers/require-value";
import { createAudio, fakeGainParam, createVideo } from "./helpers/blend-audio";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = await readPageScript("src/addons/bundled/blend/scripts/blend.script.ts");
const disableSource = await readPageScript("src/addons/bundled/blend/scripts/blend-disable.script.ts");

const SEGMENT_URL = "https://rr1.googlevideo.com/videoplayback?itag=141&mime=audio%2Fmp4&range=0-9999&rn=5&ump=1&pot=abc&sig=xyz";

let outGain: ReturnType<typeof fakeGainParam>;
let context: { currentTime: number };
let audios: ReturnType<typeof createAudio>[];
let listeners: Map<string, (() => void)[]>;
let video: ReturnType<typeof createVideo>;
let advanced: ReturnType<typeof vi.fn>;
let apiNextVideo: ReturnType<typeof vi.fn>;
let isNextButtonPresent: boolean;
let currentId: string;

let priorTracksS: number;
let appendedNextS: number;

let playerState: number;
let isClockReadable: boolean;
let resourceEntries: { name: string }[];
let perf: { bufferSize: number | null; cleared: number; bufferFull: (() => void)[] };
let nowMs: number;

function dispatch(type: string) {
  for (const listener of [...(listeners.get(type) ?? [])]) listener();
}

const postAddonMessage = vi.fn<(addon: string, name: string, data: unknown) => void>();

function pageWindow() {
  return requireRecord(globalThis.window);
}

function diags(): Record<string, unknown>[] {
  return postAddonMessage.mock.calls.filter((call) => call[1] === "diag").map((call) => requireRecord(call[2]));
}

function events() {
  return diags().map((diag) => diag.event);
}

function run(config: Record<string, unknown> = {}) {
  return runPageScript(source, {
    seconds: 5,
    blendSkips: false,
    repeatOne: false,
    adPlaying: false,
    hasNext: true,
    ...config,
  });
}

function runDisable() {
  return runPageScript(disableSource);
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
  return outGain.calls.filter((call) => call.method !== "cancel").at(-1);
}

beforeEach(() => {
  postAddonMessage.mockClear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  listeners = new Map();
  audios = [];
  currentId = "trackA";
  priorTracksS = 0;
  appendedNextS = 0;
  playerState = 1;
  isClockReadable = true;
  nowMs = 10_000;
  advanced = vi.fn();
  apiNextVideo = vi.fn();
  isNextButtonPresent = true;
  resourceEntries = [{ name: SEGMENT_URL }];
  perf = { bufferSize: null, cleared: 0, bufferFull: [] };
  outGain = fakeGainParam();
  context = { currentTime: 100 };

  video = createVideo(listeners);

  const globals = globalThis as Record<string, unknown>;
  globals.Audio = vi.fn(function () {
    const audio = createAudio();
    audios.push(audio);
    return audio;
  });
  globals.window = {
    __ytmdEnsureAudioGraph: () => ({ context, source: {}, out: { gain: outGain } }),
    ytmd: { postAddonMessage },
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

            getDuration: () => video.duration - priorTracksS,
            getPlayerResponse: () => (isClockReadable ? { videoDetails: { lengthSeconds: String(video.duration - priorTracksS - appendedNextS) } } : undefined),
            nextVideo: apiNextVideo,
          },
          querySelector: (inner: string) => (inner === ".next-button" && isNextButtonPresent ? { click: advanced } : null),
        };
      }
      return null;
    },
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
    },
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
    requireValue(perf.bufferFull[0]).call(perf.bufferFull);
    expect(perf.cleared).toBe(1);
  });

  it("arms a silent shadow from a stripped segment URL, in step with the track", () => {
    run();
    armAt(30);
    expect(audios).toHaveLength(1);
    const url = new URL(requireValue(audios[0]).src);
    for (const param of ["range", "rn", "ump", "rbuf", "srfvp", "alr"]) expect(url.searchParams.has(param)).toBe(false);
    expect(url.searchParams.get("itag")).toBe("141");
    expect(requireValue(audios[0]).volume).toBe(0);
    expect(requireValue(audios[0]).currentTime).toBe(30);
    expect(requireValue(audios[0]).paused).toBe(false);
    expect(events()).toContain("armed");
  });

  it("arms from the audio entry that matches this track's length, not a newer prefetch of the next one", () => {
    resourceEntries = [
      { name: "https://rr1.googlevideo.com/videoplayback?itag=141&mime=audio%2Fmp4&dur=200.090&id=current&range=0-9999" },
      { name: "https://rr1.googlevideo.com/videoplayback?itag=141&mime=audio%2Fmp4&dur=238.190&id=next&range=0-9999" },
    ];
    run();
    armAt(30);

    expect(audios).toHaveLength(1);
    expect(new URL(requireValue(audios[0]).src).searchParams.get("id")).toBe("current");
  });

  it("waits for this track's audio rather than arming another song's", () => {
    resourceEntries = [{ name: "https://rr1.googlevideo.com/videoplayback?itag=141&mime=audio%2Fmp4&dur=238.190&id=next" }];
    run();
    armAt(30);
    expect(audios).toHaveLength(0);
    expect(events()).toEqual(["armFailed"]);

    resourceEntries.push({ name: "https://rr1.googlevideo.com/videoplayback?itag=141&mime=audio%2Fmp4&dur=200.090&id=current" });
    armAt(31);
    expect(new URL(requireValue(audios[0]).src).searchParams.get("id")).toBe("current");
  });

  it("does not re-arm a segment URL that already failed, only a fresh one", () => {
    run();
    video.currentTime = 30;
    dispatch("timeupdate");
    requireValue(audios[0]).error = { code: 4 };
    requireValue(audios[0]).emit("error");
    for (let i = 0; i < 50; i++) {
      video.currentTime += 0.25;
      dispatch("timeupdate");
    }
    expect(audios).toHaveLength(1);
    expect(events().filter((event) => event === "armFailed")).toHaveLength(1);

    resourceEntries.push({ name: SEGMENT_URL.replace("sig=xyz", "sig=fresh") });
    armAt(45);
    expect(audios).toHaveLength(2);
    expect(new URL(requireValue(audios[1]).src).searchParams.get("sig")).toBe("fresh");
    expect(events()).toContain("armed");
  });

  it("corrects shadow drift while it is silent, and never during a blend", () => {
    run();
    armAt(30);
    requireValue(audios[0]).currentTime = 30.5;
    video.currentTime = 31;
    dispatch("timeupdate");
    expect(requireValue(audios[0]).currentTime).toBe(31);

    armAt(195.5);
    requireValue(audios[0]).currentTime = 100;
    video.currentTime = 196;
    dispatch("timeupdate");
    expect(requireValue(audios[0]).currentTime).toBe(100);
  });

  it("blends at the end: shadow up to the ear level, out gain to zero, player advanced", () => {
    run();
    armAt(30);
    armAt(195.5);

    expect(audios).toHaveLength(1);
    expect(requireValue(audios[0]).volume).toBe(0.83);
    expect(lastGainValue()).toMatchObject({ method: "target", value: 0 });
    expect(advanced).toHaveBeenCalledTimes(1);
    expect(diags().find((diag) => diag.event === "blend")).toMatchObject({ kind: "end", seconds: 5 });
  });

  it("advances through the player bar's Next button, not the player API", () => {
    run();
    armAt(30);
    armAt(195.5);

    expect(advanced).toHaveBeenCalledTimes(1);
    expect(apiNextVideo).not.toHaveBeenCalled();
  });

  it("falls back to the player API when the Next button is gone, and says so", () => {
    isNextButtonPresent = false;
    run();
    armAt(30);
    armAt(195.5);

    expect(apiNextVideo).toHaveBeenCalledTimes(1);
    expect(events()).toContain("advanceFallback");
  });

  it("blends on the track length, not the element clock or the buffered extent", () => {
    priorTracksS = 112.33;
    appendedNextS = 49;
    video.duration = priorTracksS + 200 + appendedNextS;

    run();
    armAt(30);
    armAt(194);
    expect(advanced).not.toHaveBeenCalled();

    armAt(195.5);
    expect(advanced).toHaveBeenCalledTimes(1);
  });

  it("blends a manual skip off the shadow already playing, without advancing again", () => {
    run({ blendSkips: true });
    armAt(30);

    changeTrackTo("trackB");
    dispatch("timeupdate");

    expect(audios).toHaveLength(1);
    expect(requireValue(audios[0]).volume).toBe(0.83);
    expect(advanced).not.toHaveBeenCalled();
    expect(diags().find((diag) => diag.event === "blend")).toMatchObject({ kind: "skip" });
  });

  it("fades the incoming track in while a skip blend is still running", () => {
    run({ blendSkips: true });
    armAt(30);

    changeTrackTo("trackB");
    dispatch("timeupdate");

    advance(1000);
    dispatch("timeupdate");

    const curve = outGain.calls.filter((call) => call.method === "curve").at(-1);
    expect(curve).toBeDefined();
    expect(requireValue(curve).duration).toBeCloseTo(4, 1);
  });

  it("does not lift the gain before our own advance has landed", () => {
    run();
    armAt(30);
    armAt(195.5);

    advance(1000);
    dispatch("timeupdate");
    expect(outGain.calls.some((call) => call.method === "curve")).toBe(false);
  });

  it("stands down when the shadow loaded but was never allowed to play", () => {
    run();
    armAt(30);
    requireValue(audios[0]).isRefusePlay = true;
    requireValue(audios[0]).paused = true;

    armAt(195.5);
    expect(advanced).not.toHaveBeenCalled();
    expect(diags().find((diag) => diag.event === "suppressed")).toMatchObject({ reason: "shadow not ready" });
  });

  it("blends a skip before the incoming track reports its length", () => {
    run({ blendSkips: true });
    armAt(30);

    isClockReadable = false;
    changeTrackTo("trackB");
    dispatch("timeupdate");

    expect(requireValue(audios[0]).volume).toBe(0.83);
    expect(diags().find((diag) => diag.event === "blend")).toMatchObject({ kind: "skip" });
  });

  it("cuts a skip when blend skips is off", () => {
    run();
    armAt(30);

    changeTrackTo("trackB");
    dispatch("timeupdate");

    expect(diags().find((diag) => diag.event === "cut")).toMatchObject({ reason: "skip" });
    expect(events()).not.toContain("blend");
    expect(requireValue(audios[0]).volume).toBe(0);
    expect(advanced).not.toHaveBeenCalled();
  });

  it("still blends an advance taken in the last seconds when blend skips is off", () => {
    run({ hasNext: false });
    armAt(30);
    armAt(197.5);
    expect(events()).not.toContain("blend");

    changeTrackTo("trackB");
    dispatch("timeupdate");

    expect(diags().find((diag) => diag.event === "blend")).toMatchObject({ kind: "skip" });
  });

  it("cuts a skip when the outgoing clock was unreadable", () => {
    run();
    armAt(30);

    isClockReadable = false;
    changeTrackTo("trackB");
    dispatch("timeupdate");

    expect(diags().find((diag) => diag.event === "cut")).toMatchObject({ reason: "skip" });
    expect(events()).not.toContain("blend");
  });

  it("cuts rather than blends a skip taken before the shadow is ready", () => {
    run();
    video.currentTime = 2;
    dispatch("timeupdate");

    changeTrackTo("trackB");
    dispatch("timeupdate");
    expect(diags().find((diag) => diag.event === "cut")).toBeDefined();
    expect(events()).not.toContain("blend");
  });

  it("ramps the shadow down on an equal power curve and releases it at the end", () => {
    run();
    armAt(30);
    armAt(195.5);
    const shadow = audios[0];

    advance(2500);
    expect(requireValue(shadow).volume).toBeCloseTo(0.83 * Math.cos(Math.PI / 4), 3);

    advance(2600);
    expect(requireValue(shadow).src).toBe("");
    expect(events()).toContain("done");
  });

  it("fades the incoming track in over what is left of the shadow ramp", () => {
    run();
    armAt(30);
    armAt(195.5);

    advance(3000);
    changeTrackTo("trackB");
    dispatch("timeupdate");

    const curve = outGain.calls.filter((call) => call.method === "curve").at(-1);
    expect(curve).toBeDefined();
    expect(requireValue(curve).duration).toBeCloseTo(2, 1);
    const curveValues = requireValue(curve).value;
    if (!(curveValues instanceof Float32Array)) throw new TypeError("Expected a volume curve");
    expect(curveValues[0]).toBeCloseTo(0, 5);
    expect(curveValues.at(-1)).toBeCloseTo(1, 5);
  });

  describe("reading how loud the track actually is", () => {
    it("goes through the native descriptor, past the volume ratio patch", () => {
      pageWindow().HTMLMediaElement_volume = { get: () => 0.42 };
      video.volume = 0.93;
      run();
      armAt(30);
      armAt(195.5);
      expect(requireValue(audios[0]).volume).toBe(0.42);
    });

    it("opens the shadow silent when the player is muted", () => {
      video.muted = true;
      run();
      armAt(30);
      armAt(195.5);
      expect(requireValue(audios[0]).volume).toBe(0);
    });

    it("silences the shadow if the player is muted mid blend", () => {
      run();
      armAt(30);
      armAt(195.5);
      expect(requireValue(audios[0]).volume).toBe(0.83);
      video.muted = true;
      dispatch("volumechange");
      expect(requireValue(audios[0]).volume).toBe(0);
    });

    it("uses the room capture level, and still blends, while a broadcast is live", () => {
      pageWindow().__ytmdAudioStream = { stopped: false, effectiveVolume: () => 0.27 };
      video.volume = 1;
      run();
      armAt(30);
      armAt(195.5);
      expect(requireValue(audios[0]).volume).toBe(0.27);
      expect(advanced).toHaveBeenCalledTimes(1);
    });

    it("falls back to the element when a half torn down capture throws", () => {
      pageWindow().__ytmdAudioStream = {
        stopped: false,
        effectiveVolume: () => {
          throw new Error("capture context closed");
        },
      };
      run();
      armAt(30);
      armAt(195.5);
      expect(requireValue(audios[0]).volume).toBe(0.83);
      expect(advanced).toHaveBeenCalledTimes(1);
    });

    it("ignores a capture that has already stopped", () => {
      pageWindow().__ytmdAudioStream = { stopped: true, effectiveVolume: () => 0.27 };
      run();
      armAt(30);
      armAt(195.5);
      expect(requireValue(audios[0]).volume).toBe(0.83);
    });
  });

  describe("suppression", () => {
    it.each([
      ["ad playing", { adPlaying: true }],
      ["repeat one", { repeatOne: true }],
      ["no next track", { hasNext: false }],
    ])("stands down for %s", (reason, config) => {
      run(config);
      armAt(30);
      armAt(195.5);
      expect(advanced).not.toHaveBeenCalled();
      expect(diags().find((diag) => diag.event === "suppressed")).toMatchObject({ reason });
    });

    it("stands down when the track clock is unreadable", () => {
      (globalThis as Record<string, unknown>).document = {
        querySelector: (selector: string) => (selector === "video" ? video : null),
      };
      run();
      video.currentTime = 195.5;
      dispatch("timeupdate");
      expect(advanced).not.toHaveBeenCalled();
    });

    it("has no other reason to stand down", () => {
      run();
      armAt(30);
      armAt(195.5);
      expect(events()).not.toContain("suppressed");
      expect(advanced).toHaveBeenCalledTimes(1);
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
      expect(diags().find((diag) => diag.event === "aborted")).toMatchObject({ reason: "paused" });
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
    expect(requireValue(audios[0]).src).toBe("");
    expect(lastGainValue()).toMatchObject({ value: 1 });
  });
});
