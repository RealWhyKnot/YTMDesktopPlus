import { requireRecord, requireValue } from "./helpers/require-value";
import { callMethod } from "./helpers/call-method";
import { readPageScript, runPageScript } from "./helpers/page-script";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installIntentionalPause } from "../src/renderer/ytmview/intentional-pause";

const enableSource = await readPageScript("src/main/integrations/nonstop/script/enable.script.ts");
const disableSource = await readPageScript("src/main/integrations/nonstop/script/disable.script.ts");
const playerBarControlsSource = await readPageScript("src/renderer/ytmview/scripts/playerbarcontrols.script.ts");

const IDLE_MS = 5000;

type Listener = (event: unknown) => void;

let nativePause: ReturnType<typeof vi.fn>;
let video: { isConnected: boolean; paused: boolean; play: ReturnType<typeof vi.fn>; pause?: () => void };
let popupContainer: { click: ReturnType<typeof vi.fn> };
let listeners: Map<string, Listener[]>;
let observers: { disconnect: ReturnType<typeof vi.fn> }[];
let mediaSessionHandlers: Map<string, unknown>;

function dispatch(type: string, event: unknown = {}) {
  for (const listener of listeners.get(type) ?? []) listener(event);
}

function run(source: string) {
  return runPageScript(source);
}

beforeEach(() => {
  vi.useFakeTimers();

  nativePause = vi.fn();
  listeners = new Map();
  observers = [];
  mediaSessionHandlers = new Map();
  popupContainer = { click: vi.fn() };

  class HTMLMediaElement {
    pause() {
      nativePause.call(this);
    }
  }
  video = Object.assign(new HTMLMediaElement(), {
    isConnected: true,
    paused: false,
    play: vi.fn(() => {
      video.paused = false;
    }),
  });

  const doc = {
    documentElement: {},
    querySelector: (selector: string) => {
      if (selector === "video") return video;
      if (selector === "ytmusic-app") return {};
      if (selector === "ytmusic-popup-container") return popupContainer;
      return null;
    },
    addEventListener: (type: string, listener: Listener) => {
      if (!listeners.has(type)) listeners.set(type, []);
      requireValue(listeners.get(type)).push(listener);
    },
    removeEventListener: (type: string, listener: Listener) => {
      const existing = listeners.get(type) ?? [];
      listeners.set(
        type,
        existing.filter((entry) => entry !== listener)
      );
    },
  };

  const globals = globalThis as Record<string, unknown>;
  globals.window = {
    PointerEvent: function () {
      return undefined;
    },
  };
  globals.document = doc;
  globals.HTMLMediaElement = HTMLMediaElement;

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      mediaSession: {
        setActionHandler: (action: string, handler: unknown) => mediaSessionHandlers.set(action, handler),
      },
    },
  });
  globals.MutationObserver = class {
    observe() {
      return undefined;
    }
    disconnect = vi.fn();
    constructor() {
      observers.push(this);
    }
  };
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ["window", "document", "HTMLMediaElement", "navigator", "MutationObserver"]) {
    Reflect.deleteProperty(globalThis, key);
  }
});

function goIdle() {
  vi.advanceTimersByTime(IDLE_MS);
}

const pageWindow = () => requireRecord(Reflect.get(globalThis, "window"));
const pageMediaSession = () => requireRecord(requireRecord(Reflect.get(globalThis, "navigator")).mediaSession);

describe("nonstop enable script", () => {
  it("lets a pause this app asked for through even when the view is idle", () => {
    run(enableSource);
    goIdle();

    pageWindow().__ytmdNonStopAllowPause = true;
    requireValue(video.pause).call(video);

    expect(nativePause).toHaveBeenCalledTimes(1);

    expect(pageWindow().__ytmdNonStopAllowPause).toBe(false);
  });

  it("lets a pause through right after the user interacts", () => {
    run(enableSource);
    goIdle();

    dispatch("pointerdown");
    requireValue(video.pause).call(video);

    expect(nativePause).toHaveBeenCalledTimes(1);
  });

  it("holds back the inactivity pause", () => {
    run(enableSource);
    goIdle();

    requireValue(video.pause).call(video);

    expect(nativePause).not.toHaveBeenCalled();
  });

  it("applies a held pause on the next interaction", () => {
    run(enableSource);
    goIdle();
    requireValue(video.pause).call(video);

    dispatch("keydown");

    expect(nativePause).toHaveBeenCalledTimes(1);
  });

  it("drops a held pause that was never the inactivity pause", () => {
    run(enableSource);
    goIdle();
    requireValue(video.pause).call(video);

    vi.advanceTimersByTime(5001);
    dispatch("keydown");

    expect(nativePause).not.toHaveBeenCalled();
  });

  it("dismisses the still-watching prompt and resumes", () => {
    run(enableSource);
    goIdle();
    requireValue(video.pause).call(video);
    video.paused = true;

    dispatch("yt-popup-opened", { detail: { nodeName: "YTMUSIC-YOU-THERE-RENDERER" } });

    expect(popupContainer.click).toHaveBeenCalledTimes(1);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(nativePause).not.toHaveBeenCalled();
  });

  it("ignores other popups", () => {
    run(enableSource);
    goIdle();

    dispatch("yt-popup-opened", { detail: { nodeName: "YTMUSIC-SOMETHING-ELSE" } });

    expect(popupContainer.click).not.toHaveBeenCalled();
  });

  it("routes the media session pause key to a real pause", () => {
    run(enableSource);
    goIdle();

    const pause = mediaSessionHandlers.get("pause");
    if (typeof pause !== "function") throw new TypeError("Pause handler was not registered");
    Reflect.apply(pause, undefined, []);

    expect(nativePause).toHaveBeenCalledTimes(1);
  });

  it("stops YTM from taking the pause key back", () => {
    run(enableSource);
    const ytmHandler = (): undefined => undefined;

    callMethod(pageMediaSession(), "setActionHandler", "pause", ytmHandler);
    callMethod(pageMediaSession(), "setActionHandler", "play", ytmHandler);

    expect(mediaSessionHandlers.get("pause")).not.toBe(ytmHandler);
    expect(mediaSessionHandlers.get("play")).toBe(ytmHandler);
  });

  it("only installs once", () => {
    run(enableSource);
    const patched = video.pause;
    run(enableSource);

    expect(video.pause).toBe(patched);
  });
});

describe("pauses the page issues on its own", () => {
  function pageElement(): Record<string, unknown> {
    const attributes = new Map<string, string>();
    return {
      classList: {
        add: () => {
          return undefined;
        },
        remove: () => {
          return undefined;
        },
        contains: () => false,
      },
      setters: {
        data: () => {
          return undefined;
        },
        iconName: () => {
          return undefined;
        },
      },
      insertAdjacentElement: () => {
        return undefined;
      },
      querySelector: () => pageElement(),
      appendChild: () => {
        return undefined;
      },
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      hasAttribute: (name: string) => attributes.has(name),
      removeAttribute: (name: string) => attributes.delete(name),
      dispatchEvent: () => {
        return undefined;
      },
      set: () => {
        return undefined;
      },
    };
  }

  function installPage() {
    const pageListeners = new Map<string, Listener>();
    const playerBar = {
      ...pageElement(),
      playing: true,
      getMenuRenderer: (): null => null,
      playerApi: {
        addEventListener: () => {
          return undefined;
        },
        getPlayerResponse: (): null => null,
        pauseVideo: () => requireValue(video.pause).call(video),
      },
    };
    const win = pageWindow();
    Object.assign(win, {
      __YTMD_HOOK__: {
        ytmStore: {
          getState: () => ({}),
          subscribe: () => {
            return undefined;
          },
          dispatch: () => {
            return undefined;
          },
        },
      },
      addEventListener: (type: string, listener: Listener) => pageListeners.set(type, listener),
      ytmd: {
        reportContractMiss: () => {
          return undefined;
        },
      },
    });
    const doc = requireRecord(Reflect.get(globalThis, "document"));
    const baseQuery = doc.querySelector;
    if (typeof baseQuery !== "function") throw new TypeError("Document querySelector is missing");
    Object.assign(doc, {
      body: pageElement(),
      createElement: () => pageElement(),
      querySelector: (selector: string): unknown =>
        selector === "ytmusic-app-layout>ytmusic-player-bar" ? playerBar : Reflect.apply(baseQuery, undefined, [selector]),
    });
    installIntentionalPause();
    run(playerBarControlsSource);
    return { pageListeners, playerBar };
  }

  it("lets the sleep timer pause through after the user has long been idle", () => {
    run(enableSource);
    const { pageListeners } = installPage();

    requireValue(pageListeners.get("yt-action"))({
      detail: { actionName: "yt-service-request", args: [null, { ytmdSleepTimerServiceEndpoint: { time: 5 } }] },
    });
    vi.advanceTimersByTime(5 * 60 * 1000);

    expect(nativePause).toHaveBeenCalledTimes(1);
    expect(pageWindow().__ytmdNonStopAllowPause).toBe(false);
  });

  it("still holds back the inactivity pause after the sleep timer fired", () => {
    run(enableSource);
    const { pageListeners } = installPage();
    requireValue(pageListeners.get("yt-action"))({
      detail: { actionName: "yt-service-request", args: [null, { ytmdSleepTimerServiceEndpoint: { time: 5 } }] },
    });
    vi.advanceTimersByTime(5 * 60 * 1000);
    nativePause.mockClear();

    requireValue(video.pause).call(video);

    expect(nativePause).not.toHaveBeenCalled();
  });
});

describe("nonstop disable script", () => {
  it("hands pause back and stops observing", () => {
    run(enableSource);
    run(disableSource);
    goIdle();

    requireValue(video.pause).call(video);

    expect(nativePause).toHaveBeenCalledTimes(1);
    expect(pageWindow().__ytmdNonStop).toBeUndefined();
    expect(observers.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("is safe to run without the enable script", () => {
    expect(() => run(disableSource)).not.toThrow();
  });
});
