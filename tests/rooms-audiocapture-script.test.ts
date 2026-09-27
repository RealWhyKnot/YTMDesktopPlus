import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enableSource = readFileSync("src/addons/bundled/rooms/scripts/audiocapture-enable.script.js", "utf8").trim();
const disableSource = readFileSync("src/addons/bundled/rooms/scripts/audiocapture-disable.script.js", "utf8").trim();
const listeningOnSource = readFileSync("src/addons/bundled/rooms/scripts/audiocapture-listening-on.script.js", "utf8").trim();
const listeningOffSource = readFileSync("src/addons/bundled/rooms/scripts/audiocapture-listening-off.script.js", "utf8").trim();

type CaptureState = {
  node: FakeWorkletNode | null;
  stopped: boolean;
  localGain: ReturnType<typeof fakeNode>;
};

class FakeWorkletNode {
  port = { postMessage: vi.fn() };
  constructor(
    readonly context: unknown,
    readonly name: string,
    readonly options: Record<string, unknown>
  ) {
    workletNodes.push(this);
  }
}

const nativeMessageChannel = globalThis.MessageChannel;

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
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
let nativeMuted: boolean;
let video: {
  volume: number;
  muted: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  dispatchEvent: ReturnType<typeof vi.fn>;
};
let post: ReturnType<typeof vi.fn>;
let consoleError: ReturnType<typeof vi.spyOn>;
let graphSource: ReturnType<typeof fakeNode>;
let graphOut: ReturnType<typeof fakeNode>;
let addModule: ReturnType<typeof vi.fn>;
let workletNodes: FakeWorkletNode[];
let pagePosts: { data: unknown; ports: unknown[] }[];

beforeEach(() => {
  vi.useFakeTimers();
  nativeVolume = 0.4;
  nativeMuted = false;
  workletNodes = [];
  pagePosts = [];
  addModule = vi.fn(() => Promise.resolve());

  class HTMLMediaElement {}
  Object.defineProperty(HTMLMediaElement.prototype, "volume", {
    configurable: true,
    get: () => nativeVolume,
    set: (value: number) => {
      nativeVolume = value;
    }
  });
  Object.defineProperty(HTMLMediaElement.prototype, "muted", {
    configurable: true,
    get: () => nativeMuted,
    set: (value: boolean) => {
      nativeMuted = value;
    }
  });
  video = Object.create(HTMLMediaElement.prototype) as typeof video;
  video.addEventListener = vi.fn();
  video.removeEventListener = vi.fn();
  video.dispatchEvent = vi.fn();

  graphSource = fakeNode();
  graphOut = fakeNode();
  const sharedContext = {
    currentTime: 0,
    createGain: () => fakeNode(),
    audioWorklet: { addModule }
  };

  class MessageChannel {
    port1 = { name: "worklet end" };
    port2 = { name: "outgoing end" };
  }

  post = vi.fn();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

  const globals = globalThis as Record<string, unknown>;
  globals.HTMLMediaElement = HTMLMediaElement;
  globals.AudioWorkletNode = FakeWorkletNode;
  globals.MessageChannel = MessageChannel;
  globals.document = { querySelector: (selector: string) => (selector === "video" ? video : null) };
  globals.window = {
    ytmd: { postAddonMessage: post },
    postMessage: (data: unknown, _origin: string, ports: unknown[]) => pagePosts.push({ data, ports }),
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
  for (const key of ["window", "document", "HTMLMediaElement", "AudioWorkletNode"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
  globalThis.MessageChannel = nativeMessageChannel;
});

describe("rooms audio capture enable", () => {
  it("pins the element to full volume and flags the capture", () => {
    run(enableSource);

    expect(captureState()).toBeDefined();
    expect(nativeVolume).toBe(1);
    expect(video.volume).toBeCloseTo(0.4, 10);
    expect(post).toHaveBeenCalledWith("rooms", "captureStatus", { muted: false });
  });

  it("taps ahead of the local volume with an audio thread node and hands its channel out of the page", async () => {
    run(enableSource);
    await settle();

    expect(addModule).toHaveBeenCalledWith("ytmd-media://capture/worklet.js");
    expect(workletNodes).toHaveLength(1);
    const [node] = workletNodes;
    expect(node.name).toBe("ytmd-room-capture");
    expect(node.options).toMatchObject({ numberOfOutputs: 0, channelCount: 2 });
    expect(node.port.postMessage).toHaveBeenCalledWith({ port: { name: "worklet end" } }, [{ name: "worklet end" }]);
    expect(graphSource.connect).toHaveBeenCalledWith(node);
    expect(graphSource.connect).not.toHaveBeenCalledWith(graphOut);
    expect(pagePosts).toEqual([{ data: { type: "ytmd-room-capture-port" }, ports: [{ name: "outgoing end" }] }]);
  });

  it("reports a capture module that fails to load", async () => {
    addModule.mockReturnValue(Promise.reject(new Error("blocked by policy")));

    run(enableSource);
    await settle();

    expect(post).toHaveBeenCalledWith("rooms", "captureStatus", { error: "Error: blocked by policy" });
    expect(workletNodes).toHaveLength(0);
  });

  it("builds nothing when capture is torn down while the module is still loading", async () => {
    run(enableSource);
    run(disableSource);
    await settle();

    expect(workletNodes).toHaveLength(0);
    expect(pagePosts).toEqual([]);
  });
});

describe("rooms audio capture teardown", () => {
  it("clears the flag even when stopping the capture node throws", async () => {
    run(enableSource);
    await settle();
    workletNodes[0].port.postMessage.mockImplementation(() => {
      throw new Error("port already closed");
    });

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

  it("tells the capture node to stop", async () => {
    run(enableSource);
    await settle();

    run(disableSource);

    expect(workletNodes[0].port.postMessage).toHaveBeenLastCalledWith({ stop: true });
  });

  it("hands the slider back at the volume the user left it on", () => {
    run(enableSource);
    video.volume = 0.25;

    run(disableSource);

    expect(Object.getOwnPropertyDescriptor(video, "volume")).toBeUndefined();
    expect(nativeVolume).toBeCloseTo(0.25, 10);
    expect(video.removeEventListener).toHaveBeenCalledWith("volumechange", expect.any(Function));
  });

  it("puts the ear path back on the shared graph", async () => {
    run(enableSource);
    await settle();
    graphSource.connect.mockClear();
    graphSource.disconnect.mockClear();

    run(disableSource);

    expect(graphSource.disconnect).toHaveBeenCalled();
    expect(graphSource.connect).toHaveBeenCalledWith(graphOut);
  });

  it("does nothing when no capture is running", () => {
    expect(() => run(disableSource)).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("rooms audio capture mute", () => {
  const earGain = () => captureState()?.localGain.gain.setTargetAtTime.mock.lastCall?.[0];

  it("leaves a local mute native while nobody is listening", () => {
    run(enableSource);
    video.muted = true;
    const onVolumeChange = video.addEventListener.mock.calls.find(([name]) => name === "volumechange")?.[1];
    onVolumeChange();

    expect(nativeMuted).toBe(true);
    expect(post).toHaveBeenLastCalledWith("rooms", "captureStatus", { muted: true });
  });

  it("keeps the broadcast playing through a local mute while someone listens", () => {
    run(enableSource);
    video.muted = true;

    run(listeningOnSource);

    expect(nativeMuted).toBe(false);
    expect(video.muted).toBe(true);
    expect(earGain()).toBe(0);
    expect(post).toHaveBeenLastCalledWith("rooms", "captureStatus", { muted: false });
  });

  it("mutes only the ear path when muting mid-listen", () => {
    run(enableSource);
    run(listeningOnSource);

    video.muted = true;

    expect(nativeMuted).toBe(false);
    expect(earGain()).toBe(0);
    expect(video.dispatchEvent).toHaveBeenCalled();

    video.muted = false;
    expect(earGain()).toBeCloseTo(0.4, 10);
  });

  it("goes back to a native mute when the last listener leaves", () => {
    run(enableSource);
    run(listeningOnSource);
    video.muted = true;

    run(listeningOffSource);

    expect(nativeMuted).toBe(true);
    expect(earGain()).toBeCloseTo(0.4, 10);
  });

  it("hands the mute back as the user left it", () => {
    run(enableSource);
    run(listeningOnSource);
    video.muted = true;

    run(disableSource);

    expect(Object.getOwnPropertyDescriptor(video, "muted")).toBeUndefined();
    expect(nativeMuted).toBe(true);
  });
});
