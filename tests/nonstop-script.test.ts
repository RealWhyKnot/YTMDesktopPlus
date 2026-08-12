import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The enable script runs in YTM's main world against real DOM, so it is
// exercised here against the smallest stand-in that still exposes the parts it
// touches. What matters is which pauses it lets through: every pause this app
// issues arrives as a plain video.pause() from an idle view, and swallowing
// those is the defect this feature is most likely to introduce.

const enableSource = readFileSync("src/main/integrations/nonstop/script/enable.script.js", "utf8").trim();
const disableSource = readFileSync("src/main/integrations/nonstop/script/disable.script.js", "utf8").trim();

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
  return new Function(`return (${source.replace(/;$/, "")})`)()();
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
  video = Object.assign(Object.create(HTMLMediaElement.prototype), {
    isConnected: true,
    paused: false,
    play: vi.fn(() => {
      video.paused = false;
    })
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
      listeners.get(type).push(listener);
    },
    removeEventListener: (type: string, listener: Listener) => {
      const existing = listeners.get(type) ?? [];
      listeners.set(
        type,
        existing.filter(entry => entry !== listener)
      );
    }
  };

  const globals = globalThis as Record<string, unknown>;
  globals.window = { PointerEvent: function () {} };
  globals.document = doc;
  globals.HTMLMediaElement = HTMLMediaElement;
  // Node defines navigator as a getter-only global, so it has to be replaced
  // rather than assigned.
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: {
      mediaSession: {
        setActionHandler: (action: string, handler: unknown) => mediaSessionHandlers.set(action, handler)
      }
    }
  });
  globals.MutationObserver = class {
    observe() {}
    disconnect = vi.fn();
    constructor() {
      observers.push(this as unknown as { disconnect: ReturnType<typeof vi.fn> });
    }
  };
});

afterEach(() => {
  vi.useRealTimers();
  for (const key of ["window", "document", "HTMLMediaElement", "navigator", "MutationObserver"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

function goIdle() {
  vi.advanceTimersByTime(IDLE_MS);
}

const pageWindow = () => (globalThis as unknown as { window: Record<string, unknown> }).window;
const pageMediaSession = () =>
  (globalThis as unknown as { navigator: { mediaSession: { setActionHandler: (action: string, handler: unknown) => void } } }).navigator.mediaSession;

describe("nonstop enable script", () => {
  it("lets a pause this app asked for through even when the view is idle", () => {
    run(enableSource);
    goIdle();

    pageWindow()["__ytmdNonStopAllowPause"] = true;
    video.pause();

    expect(nativePause).toHaveBeenCalledTimes(1);
    // Consumed, so the next inactivity pause is still held back.
    expect(pageWindow()["__ytmdNonStopAllowPause"]).toBe(false);
  });

  it("lets a pause through right after the user interacts", () => {
    run(enableSource);
    goIdle();

    dispatch("pointerdown");
    video.pause();

    expect(nativePause).toHaveBeenCalledTimes(1);
  });

  it("holds back the inactivity pause", () => {
    run(enableSource);
    goIdle();

    video.pause();

    expect(nativePause).not.toHaveBeenCalled();
  });

  it("applies a held pause on the next interaction", () => {
    run(enableSource);
    goIdle();
    video.pause();

    dispatch("keydown");

    expect(nativePause).toHaveBeenCalledTimes(1);
  });

  it("drops a held pause that was never the inactivity pause", () => {
    run(enableSource);
    goIdle();
    video.pause();

    vi.advanceTimersByTime(5001);
    dispatch("keydown");

    expect(nativePause).not.toHaveBeenCalled();
  });

  it("dismisses the still-watching prompt and resumes", () => {
    run(enableSource);
    goIdle();
    video.pause();
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

    (mediaSessionHandlers.get("pause") as () => void)();

    expect(nativePause).toHaveBeenCalledTimes(1);
  });

  it("stops YTM from taking the pause key back", () => {
    run(enableSource);
    const ytmHandler = (): undefined => undefined;

    pageMediaSession().setActionHandler("pause", ytmHandler);
    pageMediaSession().setActionHandler("play", ytmHandler);

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

describe("nonstop disable script", () => {
  it("hands pause back and stops observing", () => {
    run(enableSource);
    run(disableSource);
    goIdle();

    video.pause();

    expect(nativePause).toHaveBeenCalledTimes(1);
    expect(pageWindow()["__ytmdNonStop"]).toBeUndefined();
    expect(observers.every(observer => observer.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("is safe to run without the enable script", () => {
    expect(() => run(disableSource)).not.toThrow();
  });
});
