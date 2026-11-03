import { requireValue } from "./helpers/require-value";
import { readPageScript, runPageScript } from "./helpers/page-script";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRecord } from "../src/shared/unknown";

const enableSource = await readPageScript("src/addons/bundled/rooms/scripts/audiocapture-enable.script.ts");
const disableSource = await readPageScript("src/addons/bundled/rooms/scripts/audiocapture-disable.script.ts");
const listeningOnSource = await readPageScript("src/addons/bundled/rooms/scripts/audiocapture-listening-on.script.ts");
const listeningOffSource = await readPageScript("src/addons/bundled/rooms/scripts/audiocapture-listening-off.script.ts");

type CaptureState = {
  node: FakeWorkletNode | null;
  stopped: boolean;
  localGain: ReturnType<typeof fakeNode>;
};

class FakeWorkletNode {
  port = { postMessage: vi.fn() };
  readonly context: unknown;
  readonly name: string;
  readonly options: Record<string, unknown>;
  constructor(context: unknown, name: string, options: Record<string, unknown>) {
    this.context = context;
    this.name = name;
    this.options = options;

    workletNodes.push(this);
  }
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

function run(source: string) {
  return runPageScript(source);
}

function captureState(): CaptureState | undefined {
  const value = pageWindow().__ytmdAudioStream;
  if (value === undefined) return undefined;
  if (
    !isRecord(value) ||
    !(value.node === null || value.node instanceof FakeWorkletNode) ||
    typeof value.stopped !== "boolean" ||
    !isFakeNode(value.localGain)
  ) {
    throw new TypeError("Invalid audio capture state in the page fixture");
  }
  return { node: value.node, stopped: value.stopped, localGain: value.localGain };
}

function pageWindow(): Record<string, unknown> {
  const value: unknown = Reflect.get(globalThis, "window");
  if (!isRecord(value)) throw new TypeError("Missing window in the audio capture fixture");
  return value;
}

function fakeNode() {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    gain: { value: 0, setTargetAtTime: vi.fn() },
  };
}

function isFakeNode(value: unknown): value is ReturnType<typeof fakeNode> {
  return (
    isRecord(value) &&
    vi.isMockFunction(value.connect) &&
    vi.isMockFunction(value.disconnect) &&
    isRecord(value.gain) &&
    typeof value.gain.value === "number" &&
    vi.isMockFunction(value.gain.setTargetAtTime)
  );
}

let nativeVolume: number;
let isNativeMuted: boolean;
let video: {
  volume: number;
  muted: boolean;
  addEventListener: ReturnType<typeof vi.fn<(name: string, callback: () => void) => void>>;
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

function isVideo(value: unknown): value is typeof video {
  return (
    isRecord(value) &&
    typeof value.volume === "number" &&
    typeof value.muted === "boolean" &&
    vi.isMockFunction(value.addEventListener) &&
    vi.isMockFunction(value.removeEventListener) &&
    vi.isMockFunction(value.dispatchEvent)
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  nativeVolume = 0.4;
  isNativeMuted = false;
  workletNodes = [];
  pagePosts = [];
  addModule = vi.fn(() => Promise.resolve());

  class HTMLMediaElement {
    get volume() {
      return nativeVolume;
    }
    set volume(value: number) {
      nativeVolume = value;
    }
    addEventListener = vi.fn<(name: string, callback: () => void) => void>();
    removeEventListener = vi.fn();
    dispatchEvent = vi.fn();
  }
  Object.defineProperty(HTMLMediaElement.prototype, "muted", {
    configurable: true,
    get: () => isNativeMuted,
    set: (isValue: boolean) => {
      isNativeMuted = isValue;
    },
  });
  const element = new HTMLMediaElement();
  if (!isVideo(element)) throw new TypeError("Invalid media element in the audio capture fixture");
  video = element;

  graphSource = fakeNode();
  graphOut = fakeNode();
  const sharedContext = {
    currentTime: 0,
    createGain: () => fakeNode(),
    audioWorklet: { addModule },
  };

  class MessageChannel {
    port1 = { name: "worklet end" };
    port2 = { name: "outgoing end" };
  }

  post = vi.fn();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {
    return undefined;
  });

  vi.stubGlobal("HTMLMediaElement", HTMLMediaElement);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal("MessageChannel", MessageChannel);
  vi.stubGlobal("document", { querySelector: (selector: string) => (selector === "video" ? video : null) });
  const page = {
    ytmd: { postAddonMessage: post },
    postMessage: (data: unknown, _origin: string, ports: unknown[]) => pagePosts.push({ data, ports }),
    __ytmdEnsureAudioGraph: () => {
      const graph = { context: sharedContext, source: graphSource, out: graphOut };
      Reflect.set(page, "__ytmdAudioGraph", graph);
      return graph;
    },
  };
  vi.stubGlobal("window", page);
});

afterEach(() => {
  consoleError.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
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
    expect(requireValue(node).name).toBe("ytmd-room-capture");
    expect(requireValue(node).options).toMatchObject({ numberOfOutputs: 0, channelCount: 2 });
    expect(requireValue(node).port.postMessage).toHaveBeenCalledWith({ port: { name: "worklet end" }, ad: false }, [{ name: "worklet end" }]);
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

describe("rooms audio capture ad gate", () => {
  function hookStore(player: unknown) {
    const store = {
      player,
      unreadable: false,
      listeners: [] as (() => void)[],
      unsubscribe: vi.fn(),
      set(next: unknown) {
        store.player = next;
        for (const listener of store.listeners) listener();
      },
    };
    pageWindow().__YTMD_HOOK__ = {
      ytmStore: {
        getState: () => {
          if (store.unreadable) throw new Error("store gone");
          return { player: store.player };
        },
        subscribe: (listener: () => void) => {
          store.listeners.push(listener);
          return store.unsubscribe;
        },
      },
    };
    return store;
  }

  it("tells the capture node once per change when an ad starts and ends", async () => {
    const store = hookStore({ adPlaying: false });
    run(enableSource);
    await settle();
    const port = requireValue(workletNodes[0]).port;
    expect(port.postMessage).toHaveBeenLastCalledWith({ port: { name: "worklet end" }, ad: false }, [{ name: "worklet end" }]);

    store.set({ adPlaying: true });
    store.set({ adPlaying: true });
    expect(port.postMessage).toHaveBeenLastCalledWith({ ad: true });
    expect(port.postMessage).toHaveBeenCalledTimes(2);

    store.set({ adPlaying: false });
    expect(port.postMessage).toHaveBeenLastCalledWith({ ad: false });
    expect(port.postMessage).toHaveBeenCalledTimes(3);
  });

  it("starts the capture node gated when an ad is already playing", async () => {
    hookStore({ adPlaying: true });
    run(enableSource);
    await settle();

    expect(requireValue(workletNodes[0]).port.postMessage).toHaveBeenCalledWith({ port: { name: "worklet end" }, ad: true }, [{ name: "worklet end" }]);
  });

  it("carries an ad that starts while the capture module loads", async () => {
    const store = hookStore({ adPlaying: false });
    run(enableSource);
    store.set({ adPlaying: true });
    await settle();

    expect(requireValue(workletNodes[0]).port.postMessage).toHaveBeenCalledWith({ port: { name: "worklet end" }, ad: true }, [{ name: "worklet end" }]);
  });

  it("reads a missing flag as no ad and holds the last state while the store cannot be read", async () => {
    const store = hookStore({ adPlaying: true });
    run(enableSource);
    await settle();
    const port = requireValue(workletNodes[0]).port;

    store.unreadable = true;
    store.set({ adPlaying: false });
    expect(port.postMessage).toHaveBeenCalledTimes(1);

    store.unreadable = false;
    store.set({});
    expect(port.postMessage).toHaveBeenLastCalledWith({ ad: false });
  });

  it("stops following the store on teardown", async () => {
    const store = hookStore({ adPlaying: false });
    run(enableSource);
    await settle();

    run(disableSource);

    expect(store.unsubscribe).toHaveBeenCalled();
  });
});

describe("rooms audio capture teardown", () => {
  it("clears the flag even when stopping the capture node throws", async () => {
    run(enableSource);
    await settle();
    requireValue(workletNodes[0]).port.postMessage.mockImplementation(() => {
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
    Reflect.deleteProperty(pageWindow(), "__ytmdAudioGraph");
    vi.stubGlobal("document", { querySelector: (): typeof video | null => null });

    run(disableSource);

    expect(captureState()).toBeUndefined();
  });

  it("tells the capture node to stop", async () => {
    run(enableSource);
    await settle();

    run(disableSource);

    expect(requireValue(workletNodes[0]).port.postMessage).toHaveBeenLastCalledWith({ stop: true });
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
  const earGain = (): unknown => captureState()?.localGain.gain.setTargetAtTime.mock.lastCall?.[0];

  it("leaves a local mute native while nobody is listening", () => {
    run(enableSource);
    video.muted = true;
    const onVolumeChange = video.addEventListener.mock.calls.find(([name]) => name === "volumechange")?.[1];
    requireValue(onVolumeChange)();

    expect(isNativeMuted).toBe(true);
    expect(post).toHaveBeenLastCalledWith("rooms", "captureStatus", { muted: true });
  });

  it("keeps the broadcast playing through a local mute while someone listens", () => {
    run(enableSource);
    video.muted = true;

    run(listeningOnSource);

    expect(isNativeMuted).toBe(false);
    expect(video.muted).toBe(true);
    expect(earGain()).toBe(0);
    expect(post).toHaveBeenLastCalledWith("rooms", "captureStatus", { muted: false });
  });

  it("mutes only the ear path when muting mid-listen", () => {
    run(enableSource);
    run(listeningOnSource);

    video.muted = true;

    expect(isNativeMuted).toBe(false);
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

    expect(isNativeMuted).toBe(true);
    expect(earGain()).toBeCloseTo(0.4, 10);
  });

  it("hands the mute back as the user left it", () => {
    run(enableSource);
    run(listeningOnSource);
    video.muted = true;

    run(disableSource);

    expect(Object.getOwnPropertyDescriptor(video, "muted")).toBeUndefined();
    expect(isNativeMuted).toBe(true);
  });
});
