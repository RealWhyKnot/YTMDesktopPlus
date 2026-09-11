import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enableSource = readFileSync("src/addons/bundled/rooms/scripts/audiocapture-enable.script.js", "utf8").trim();
const disableSource = readFileSync("src/addons/bundled/rooms/scripts/audiocapture-disable.script.js", "utf8").trim();

type CaptureState = {
  pending: { t: number; d: ArrayBuffer }[];
  flushTimer: number;
  encoder: { state: string } | null;
  reader: unknown;
  stopped: boolean;
};

function run(source: string) {
  return new Function(`return (${source.replace(/;$/, "")})`)()();
}

function captureState(): CaptureState | undefined {
  return (globalThis as unknown as { window: { __ytmdAudioStream?: CaptureState } }).window.__ytmdAudioStream;
}

function fakeNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: { value: 0, setTargetAtTime: vi.fn() }
  };
}

let nativeVolume: number;
let video: { volume: number; muted: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let post: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;
let graphSource: ReturnType<typeof fakeNode>;
let graphOut: ReturnType<typeof fakeNode>;
let closeCapture: () => Promise<void>;
let configureEncoder: () => void;
let encoderClosed: number;

beforeEach(() => {
  vi.useFakeTimers();
  nativeVolume = 0.4;
  encoderClosed = 0;
  closeCapture = () => Promise.resolve();
  configureEncoder = () => {};

  class HTMLMediaElement {}
  Object.defineProperty(HTMLMediaElement.prototype, "volume", {
    configurable: true,
    get: () => nativeVolume,
    set: (value: number) => {
      nativeVolume = value;
    }
  });
  video = Object.create(HTMLMediaElement.prototype) as typeof video;
  video.muted = false;
  video.addEventListener = vi.fn();
  video.removeEventListener = vi.fn();

  graphSource = fakeNode();
  graphOut = fakeNode();
  const sharedContext = {
    currentTime: 0,
    createGain: () => fakeNode(),
    createMediaStreamDestination: () => ({ stream: { getAudioTracks: () => [{}] } })
  };

  class AudioContext {
    state = "running";
    resume = vi.fn();
    createMediaStreamSource = () => fakeNode();
    createMediaStreamDestination = () => ({ stream: { getAudioTracks: () => [{}] } });
    close = () => closeCapture();
  }

  class AudioEncoder {
    state = "unconfigured";
    configure() {
      configureEncoder();
      this.state = "configured";
    }
    close() {
      encoderClosed++;
      this.state = "closed";
    }
  }

  class MediaStreamTrackProcessor {
    readable = {
      getReader: () => ({
        read: () => Promise.resolve({ done: true }),
        cancel: () => Promise.resolve()
      })
    };
  }

  post = vi.fn();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  const globals = globalThis as Record<string, unknown>;
  globals.HTMLMediaElement = HTMLMediaElement;
  globals.AudioContext = AudioContext;
  globals.AudioEncoder = AudioEncoder;
  globals.MediaStreamTrackProcessor = MediaStreamTrackProcessor;
  globals.document = { querySelector: (selector: string) => (selector === "video" ? video : null) };
  globals.window = {
    ytmd: { postAddonMessage: post },
    __ytmdEnsureAudioGraph: () => {
      const graphWindow = globals.window as { __ytmdAudioGraph?: unknown };
      const graph = { context: sharedContext, source: graphSource, out: graphOut };
      graphWindow.__ytmdAudioGraph = graph;
      return graph;
    }
  };
});

afterEach(() => {
  consoleError.mockRestore();
  vi.useRealTimers();
  for (const key of ["window", "document", "HTMLMediaElement", "AudioContext", "AudioEncoder", "MediaStreamTrackProcessor"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

describe("rooms audio capture enable", () => {
  it("pins the element to full volume and flags the capture", () => {
    run(enableSource);

    expect(captureState()).toBeDefined();
    expect(nativeVolume).toBe(1);
    expect(video.volume).toBeCloseTo(0.4, 10);
    expect(post).toHaveBeenCalledWith("rooms", "captureStatus", { cfg: { sr: 48000, ch: 2, br: 128000 }, muted: false });
  });

  it("reports a failed encoder setup instead of running half started", () => {
    configureEncoder = () => {
      throw new Error("codec unsupported");
    };

    run(enableSource);

    expect(post).toHaveBeenCalledWith("rooms", "captureStatus", { error: "Error: codec unsupported" });
    expect(post).not.toHaveBeenCalledWith("rooms", "captureStatus", expect.objectContaining({ cfg: expect.anything() }));
    expect(captureState()?.flushTimer).toBe(0);

    run(disableSource);
    expect(captureState()).toBeUndefined();
    expect(nativeVolume).toBeCloseTo(0.4, 10);
  });
});

describe("rooms audio capture teardown", () => {
  it("clears the flag even when closing the capture context throws", () => {
    run(enableSource);
    closeCapture = () => {
      throw new Error("context already closed");
    };

    run(disableSource);

    expect(captureState()).toBeUndefined();
    expect(consoleError).toHaveBeenCalled();

    run(enableSource);
    expect(captureState()).toBeDefined();
  });

  it("clears the flag when the graph and the element have already gone", () => {
    run(enableSource);
    const globals = globalThis as Record<string, unknown>;
    delete (globals.window as { __ytmdAudioGraph?: unknown }).__ytmdAudioGraph;
    globals.document = { querySelector: (): typeof video | null => null };

    run(disableSource);

    expect(captureState()).toBeUndefined();
  });

  it("stops the flush timer so the page stops posting batches", () => {
    run(enableSource);
    const state = captureState();
    state?.pending.push({ t: 0, d: new ArrayBuffer(4) });

    run(disableSource);
    post.mockClear();
    vi.advanceTimersByTime(2000);

    expect(post).not.toHaveBeenCalled();
  });

  it("hands the slider back at the volume the user left it on", () => {
    run(enableSource);
    video.volume = 0.25;

    run(disableSource);

    expect(Object.getOwnPropertyDescriptor(video, "volume")).toBeUndefined();
    expect(nativeVolume).toBeCloseTo(0.25, 10);
    expect(video.removeEventListener).toHaveBeenCalledWith("volumechange", expect.any(Function));
  });

  it("puts the ear path back on the shared graph and closes the encoder", () => {
    run(enableSource);
    graphSource.connect.mockClear();
    graphSource.disconnect.mockClear();

    run(disableSource);

    expect(graphSource.disconnect).toHaveBeenCalled();
    expect(graphSource.connect).toHaveBeenCalledWith(graphOut);
    expect(encoderClosed).toBe(1);
  });

  it("does nothing when no capture is running", () => {
    expect(() => run(disableSource)).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
