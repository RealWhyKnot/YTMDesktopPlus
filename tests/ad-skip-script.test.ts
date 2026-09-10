import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AD_SKIP_SELECTORS } from "../src/shared/ad-contract";

// The fallback layer for ads the player-response prune cannot reach. It runs in
// YouTube Music's main world off YTM's own adPlaying flag, so it is exercised
// here against the smallest stand-in that still exposes what it touches. The
// property that matters most is what it restores: an ad break must leave the
// element exactly as it found it.

const enableSource = readFileSync("src/main/integrations/ad-blocker/script/enable.script.js", "utf8").trim();
const disableSource = readFileSync("src/main/integrations/ad-blocker/script/disable.script.js", "utf8").trim();

type Video = { muted: boolean; playbackRate: number; currentTime: number };

let video: Video;
let videoAttached: boolean;
let currentTimeWrites: number;
let skipButton: { disabled: boolean; width: number; click: ReturnType<typeof vi.fn> } | null;
let skipSelector: string;
let queried: string[];
let subscribers: Array<() => void>;
let unsubscribed: number;
let adPlaying: boolean;
let playerPresent: boolean;
let events: Array<[string, unknown]>;

function run(source: string) {
  return new Function(`return (${source.replace(/;$/, "")})`)()();
}

function setAdPlaying(value: boolean) {
  adPlaying = value;
  for (const subscriber of [...subscribers]) subscriber();
}

beforeEach(() => {
  vi.useFakeTimers();

  currentTimeWrites = 0;
  videoAttached = true;
  skipButton = null;
  skipSelector = AD_SKIP_SELECTORS[0];
  queried = [];
  subscribers = [];
  unsubscribed = 0;
  adPlaying = false;
  playerPresent = true;
  events = [];

  video = {
    muted: false,
    playbackRate: 1,
    get currentTime() {
      return 12;
    },
    set currentTime(_value: number) {
      currentTimeWrites++;
    }
  } as Video;

  (globalThis as { document?: unknown }).document = {
    querySelector: (selector: string) => {
      queried.push(selector);
      if (selector === "video") return videoAttached ? video : null;
      if (!skipButton || selector !== skipSelector) return null;
      return { disabled: skipButton.disabled, click: skipButton.click, getBoundingClientRect: () => ({ width: skipButton.width }) };
    }
  };

  (globalThis as { window?: unknown }).window = {
    __YTMD_HOOK__: {
      ytmStore: {
        getState: () => (playerPresent ? { player: { adPlaying } } : {}),
        subscribe: (callback: () => void) => {
          subscribers.push(callback);
          return () => {
            unsubscribed++;
            subscribers = subscribers.filter(entry => entry !== callback);
          };
        }
      }
    },
    ytmd: { sendAdBlockEvent: (kind: string, detail: unknown) => events.push([kind, detail]) }
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { window?: unknown }).window;
  delete (globalThis as { document?: unknown }).document;
});

describe("ad skip enable script", () => {
  it("mutes and runs the element fast while an ad plays", () => {
    run(enableSource);
    setAdPlaying(true);

    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBe(16);
    expect(events).toContainEqual(["adPlaying", null]);
  });

  it("restores the values the user had, not defaults", () => {
    video.muted = true;
    video.playbackRate = 1.25;

    run(enableSource);
    setAdPlaying(true);
    setAdPlaying(false);

    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBe(1.25);
  });

  it("never seeks", () => {
    // YouTube Music plays consecutive tracks on one MediaSource, so currentTime
    // spans every track appended so far and seeking off it lands in the music.
    run(enableSource);
    setAdPlaying(true);
    vi.advanceTimersByTime(2000);
    setAdPlaying(false);

    expect(currentTimeWrites).toBe(0);
  });

  it("reasserts mute and rate that YTM sets back mid break", () => {
    run(enableSource);
    setAdPlaying(true);

    video.muted = false;
    video.playbackRate = 1;
    vi.advanceTimersByTime(250);

    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBe(16);
  });

  it("clicks the skip control once it appears and reports it once", () => {
    run(enableSource);
    setAdPlaying(true);

    skipButton = { disabled: false, width: 90, click: vi.fn() };
    vi.advanceTimersByTime(750);

    expect(skipButton.click).toHaveBeenCalled();
    expect(events.filter(([kind]) => kind === "skipped")).toHaveLength(1);
  });

  it("leaves a hidden or disabled skip control alone", () => {
    run(enableSource);
    setAdPlaying(true);

    skipButton = { disabled: true, width: 90, click: vi.fn() };
    vi.advanceTimersByTime(250);
    skipButton = { disabled: false, width: 0, click: vi.fn() };
    vi.advanceTimersByTime(250);

    expect(skipButton.click).not.toHaveBeenCalled();
  });

  it("stops polling once the ad ends", () => {
    run(enableSource);
    setAdPlaying(true);
    setAdPlaying(false);

    skipButton = { disabled: false, width: 90, click: vi.fn() };
    vi.advanceTimersByTime(2000);

    expect(skipButton.click).not.toHaveBeenCalled();
  });

  it("installs once", () => {
    run(enableSource);
    run(enableSource);

    expect(subscribers).toHaveLength(1);
  });

  it("queries the contract selectors, in order", () => {
    run(enableSource);
    setAdPlaying(true);
    queried.length = 0;
    vi.advanceTimersByTime(250);

    expect(queried.filter(selector => selector !== "video")).toEqual([...AD_SKIP_SELECTORS]);
  });

  it("stops at the first usable control rather than clicking every match", () => {
    skipButton = { disabled: false, width: 90, click: vi.fn() };
    skipSelector = AD_SKIP_SELECTORS[1];

    run(enableSource);
    setAdPlaying(true);
    queried.length = 0;
    vi.advanceTimersByTime(250);

    expect(queried.filter(selector => selector !== "video")).toEqual([AD_SKIP_SELECTORS[0], AD_SKIP_SELECTORS[1]]);
    expect(skipButton.click).toHaveBeenCalled();
  });

  it("takes over an element that only appears after the break starts", () => {
    videoAttached = false;

    run(enableSource);
    setAdPlaying(true);

    expect(video.muted).toBe(false);

    video.muted = true;
    video.playbackRate = 1.25;
    videoAttached = true;
    vi.advanceTimersByTime(250);

    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBe(16);

    setAdPlaying(false);

    expect(video.muted).toBe(true);
    expect(video.playbackRate).toBe(1.25);
  });

  it("ends the break cleanly when the element went away with the page", () => {
    run(enableSource);
    setAdPlaying(true);
    videoAttached = false;

    expect(() => setAdPlaying(false)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("restores once and stacks no timers when the flag flaps", () => {
    video.playbackRate = 1.25;

    run(enableSource);
    setAdPlaying(true);
    setAdPlaying(false);
    setAdPlaying(true);
    setAdPlaying(false);

    expect(video.muted).toBe(false);
    expect(video.playbackRate).toBe(1.25);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("treats a store with no player as no ad", () => {
    playerPresent = false;

    expect(() => run(enableSource)).not.toThrow();
    expect(video.muted).toBe(false);
  });

  it("ends the break if the player slice disappears mid ad", () => {
    run(enableSource);
    setAdPlaying(true);

    expect(video.muted).toBe(true);

    playerPresent = false;
    for (const subscriber of [...subscribers]) subscriber();

    expect(video.muted).toBe(false);
    expect(video.playbackRate).toBe(1);
  });
});

describe("ad skip disable script", () => {
  it("unsubscribes and restores an element caught mid break", () => {
    video.playbackRate = 1.25;

    run(enableSource);
    setAdPlaying(true);
    run(disableSource);

    expect(unsubscribed).toBe(1);
    expect(video.muted).toBe(false);
    expect(video.playbackRate).toBe(1.25);
    expect((globalThis as unknown as { window: { __ytmdAdSkip?: unknown } }).window.__ytmdAdSkip).toBeUndefined();
  });

  it("does nothing when the enable script never ran", () => {
    expect(() => run(disableSource)).not.toThrow();
  });
});
