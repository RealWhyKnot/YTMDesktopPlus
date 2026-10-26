import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  openExternal: vi.fn(async () => {})
}));

vi.mock("electron", () => ({
  shell: { openExternal: electronMock.openExternal },
  safeStorage: {
    decryptString: (buffer: Buffer) => buffer.toString(),
    encryptString: (value: string) => Buffer.from(value)
  }
}));

import LastFM from "../src/main/integrations/last-fm";
import { VideoState, type PlayerState } from "../src/main/player-state-store";
import { createLaunchPause } from "../src/main/playback/launch-pause";
import type { PlayerQueue, PlayerQueueItem } from "~shared/addons/sdk";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

type Internals = {
  isEnabled: boolean;
  possibleVideoIds: string[] | null;
  updatePlayerState(state: PlayerState): Promise<void>;
};

function enabledInstance() {
  const instance = new LastFM() as unknown as Internals;
  instance.isEnabled = true;
  return instance;
}

function queueItem(overrides: Partial<PlayerQueueItem> = {}): PlayerQueueItem {
  return {
    thumbnails: [],
    title: "Track",
    author: "Artist",
    duration: "3:00",
    selected: true,
    videoId: "vid",
    counterparts: null,
    ...overrides
  };
}

function queue(overrides: Partial<PlayerQueue> = {}): PlayerQueue {
  return {
    automixItems: [],
    autoplay: false,
    isGenerating: false,
    isInfinite: false,
    items: [queueItem()],
    repeatMode: 0 as PlayerQueue["repeatMode"],
    selectedItemIndex: 0,
    ...overrides
  };
}

const playing = (overrides: Partial<PlayerState> = {}) =>
  makePlayerState({ videoDetails: makeVideoDetails({ id: "vid" }), trackState: VideoState.Playing, ...overrides });

describe("updatePlayerState with an absent queue", () => {
  it("does not throw when the queue is null", async () => {
    const instance = enabledInstance();
    await expect(instance.updatePlayerState(playing({ queue: null }))).resolves.toBeUndefined();
  });

  it("falls back to the playing video id so the track can still be recognised", async () => {
    const instance = enabledInstance();
    await instance.updatePlayerState(playing({ queue: null }));
    expect(instance.possibleVideoIds).toEqual(["vid"]);
  });

  it("does not throw when the selected index is out of range", async () => {
    const instance = enabledInstance();
    await expect(instance.updatePlayerState(playing({ queue: queue({ selectedItemIndex: 7 }) }))).resolves.toBeUndefined();
    expect(instance.possibleVideoIds).toEqual(["vid"]);
  });
});

describe("updatePlayerState with a queue", () => {
  it("collects counterpart ids alongside the selected item", async () => {
    const instance = enabledInstance();
    const selected = queueItem({ videoId: "audio", counterparts: [queueItem({ videoId: "video" })] });
    await instance.updatePlayerState(playing({ videoDetails: makeVideoDetails({ id: "audio" }), queue: queue({ items: [selected] }) }));
    expect(instance.possibleVideoIds).toEqual(["video", "audio"]);
  });
});

type ApiReply = { status?: number; body?: unknown; network?: boolean };
type ApiCall = { method: string; params: URLSearchParams };
type Details = Parameters<typeof makeVideoDetails>[0];
type StartOptions = { sessionKey?: string | null; token?: string | null; scrobblePercent?: number };

const hex = (value: string) => Buffer.from(value).toString("hex");

function fakeLastfm(replies: (call: ApiCall) => ApiReply) {
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: URLSearchParams }) => {
    const params = init?.body ? new URLSearchParams(init.body) : new URL(url).searchParams;
    const call = { method: params.get("method") ?? "", params };
    calls.push(call);
    const reply = replies(call);
    if (reply.network) throw new TypeError("fetch failed");
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (reply.body === undefined) throw new SyntaxError("Unexpected token <");
        return reply.body;
      }
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    calls,
    count: (method: string) => calls.filter(call => call.method === method).length
  };
}

function connectedLastfm(options: StartOptions = {}) {
  const sets: Array<[string, unknown]> = [];
  const lastfm = {
    api_key: "key",
    secret: "secret",
    sessionKey: options.sessionKey === undefined ? hex("session") : options.sessionKey,
    token: options.token ?? null,
    scrobblePercent: options.scrobblePercent ?? 50
  };
  const store = {
    get: (key: string) => (key === "lastfm" ? { ...lastfm } : key === "lastfm.scrobblePercent" ? lastfm.scrobblePercent : undefined),
    set: (key: string, value: unknown) => {
      sets.push([key, value]);
    }
  };
  const memoryStore = { get: (key: string) => key === "safeStorageAvailable" };
  const lastFm = new LastFM();
  lastFm.provide(store as never, memoryStore as never);
  return { lastFm, internals: lastFm as unknown as Internals, sets };
}

const track = (overrides: Partial<PlayerState> = {}, details: Details = {}) =>
  makePlayerState({
    videoDetails: makeVideoDetails({ id: "vid", durationSeconds: 180, ...details }),
    trackState: VideoState.Playing,
    queue: queue(),
    ...overrides
  });

async function playThrough(internals: Internals, from: number, to: number, overrides: Partial<PlayerState> = {}, details: Details = {}) {
  for (let progress = from; progress <= to; progress++) {
    await internals.updatePlayerState(track({ videoProgress: progress, ...overrides }, details));
    await vi.advanceTimersByTimeAsync(1000);
  }
}

const okReply = (call: ApiCall): ApiReply => {
  if (call.method === "auth.gettoken") return { body: { token: "token" } };
  if (call.method === "auth.getSession") return { body: { session: { name: "me", key: "session", subscriber: 0 } } };
  return { body: {} };
};

const unauthorized: ApiReply = { status: 403, body: { error: 14, message: "Unauthorized Token" } };

describe("Last.fm with a fake API", () => {
  let active: LastFM[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    electronMock.openExternal.mockClear();
    active = [];
  });

  afterEach(() => {
    for (const lastFm of active) lastFm.disable();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  function start(options: StartOptions = {}) {
    const made = connectedLastfm(options);
    made.lastFm.enable();
    active.push(made.lastFm);
    return made;
  }

  describe("scrobbling by time actually played", () => {
    it("scrobbles once at half the track and not while paused", async () => {
      const api = fakeLastfm(okReply);
      const { internals } = start();

      await playThrough(internals, 0, 60);
      for (let i = 0; i < 200; i++) {
        await internals.updatePlayerState(track({ videoProgress: 60, trackState: VideoState.Paused }));
        await vi.advanceTimersByTimeAsync(1000);
      }
      await playThrough(internals, 60, 89);
      expect(api.count("track.scrobble")).toBe(0);
      expect(api.count("track.updateNowPlaying")).toBe(1);

      await playThrough(internals, 90, 179);
      expect(api.count("track.scrobble")).toBe(1);
    });

    it("caps the play time needed at four minutes", async () => {
      const api = fakeLastfm(okReply);
      const { internals } = start();

      await playThrough(internals, 0, 239, {}, { durationSeconds: 1200 });
      expect(api.count("track.scrobble")).toBe(0);
      await playThrough(internals, 240, 241, {}, { durationSeconds: 1200 });
      expect(api.count("track.scrobble")).toBe(1);
    });

    it("does not count ads", async () => {
      const api = fakeLastfm(okReply);
      const { internals } = start();

      await playThrough(internals, 0, 120, { adPlaying: true });
      expect(api.calls).toHaveLength(0);
      await playThrough(internals, 0, 89);
      expect(api.count("track.scrobble")).toBe(0);
      await playThrough(internals, 90, 91);
      expect(api.count("track.scrobble")).toBe(1);
    });

    it("does not count a seek forward", async () => {
      const api = fakeLastfm(okReply);
      const { internals } = start();

      await playThrough(internals, 0, 10);
      await playThrough(internals, 170, 179);
      expect(api.count("track.scrobble")).toBe(0);
    });

    it("keeps counting when the queue is missing", async () => {
      const api = fakeLastfm(okReply);
      const { internals } = start();

      await playThrough(internals, 0, 100, { queue: null });
      expect(api.count("track.scrobble")).toBe(1);
      expect(api.count("track.updateNowPlaying")).toBe(1);
    });

    it("waits four minutes and leaves duration out when the duration is unknown", async () => {
      const api = fakeLastfm(okReply);
      const { internals } = start();

      await playThrough(internals, 0, 120, {}, { durationSeconds: NaN });
      expect(api.count("track.scrobble")).toBe(0);
      await playThrough(internals, 121, 241, {}, { durationSeconds: NaN });
      expect(api.count("track.scrobble")).toBe(1);
      for (const call of api.calls) expect(call.params.has("duration")).toBe(false);
    });

    it("skips tracks of 30 seconds or less", async () => {
      const api = fakeLastfm(okReply);
      const { internals } = start();

      await playThrough(internals, 0, 30, {}, { durationSeconds: 30 });
      expect(api.calls).toHaveLength(0);
    });

    it("scrobbles a track again when it repeats", async () => {
      const api = fakeLastfm(okReply);
      const { internals } = start();

      await playThrough(internals, 0, 179);
      await playThrough(internals, 0, 100);
      expect(api.count("track.scrobble")).toBe(2);
      expect(api.count("track.updateNowPlaying")).toBe(2);
    });

    it("starts over after being turned off and on", async () => {
      const api = fakeLastfm(okReply);
      const { lastFm, internals } = start();

      await playThrough(internals, 0, 60);
      lastFm.disable();
      lastFm.enable();
      await playThrough(internals, 60, 120);
      expect(api.count("track.scrobble")).toBe(0);
    });

    it("does not count the paused restore at launch", async () => {
      const api = fakeLastfm(okReply);
      const { internals } = start();
      const launchPause = createLaunchPause({ addEventListener: () => {}, removeEventListener: () => {}, send: () => {} });
      void launchPause.arm("vid", true);

      await playThrough(internals, 0, 100);
      launchPause.cancel();
      await playThrough(internals, 100, 120);
      expect(api.calls).toHaveLength(0);

      await internals.updatePlayerState(track({ videoProgress: 120, trackState: VideoState.Paused }));
      await playThrough(internals, 120, 209);
      expect(api.count("track.updateNowPlaying")).toBe(1);
      expect(api.count("track.scrobble")).toBe(0);
      await playThrough(internals, 210, 211);
      expect(api.count("track.scrobble")).toBe(1);
    });
  });

  describe("errors", () => {
    it("clears the session on error 9 without opening the browser", async () => {
      const api = fakeLastfm(call => (call.method.startsWith("track.") ? { status: 403, body: { error: 9, message: "Invalid session key" } } : okReply(call)));
      const { internals, sets } = start();

      await playThrough(internals, 0, 120);
      expect(sets).toContainEqual(["lastfm.sessionKey", null]);
      expect(api.count("track.updateNowPlaying")).toBe(1);
      expect(api.count("track.scrobble")).toBe(0);
      expect(electronMock.openExternal).not.toHaveBeenCalled();
    });

    it("backs off on rate limits and retries the scrobble later", async () => {
      let scrobbleTries = 0;
      const api = fakeLastfm(call => {
        if (call.method === "track.scrobble" && scrobbleTries++ === 0) return { body: { error: 29, message: "Rate limit exceeded" } };
        return okReply(call);
      });
      const { internals } = start();

      await playThrough(internals, 0, 100);
      expect(api.count("track.scrobble")).toBe(1);
      await vi.advanceTimersByTimeAsync(15 * 1000);
      expect(api.count("track.scrobble")).toBe(1);
      await vi.advanceTimersByTimeAsync(10 * 1000);
      expect(api.count("track.scrobble")).toBe(2);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(api.count("track.scrobble")).toBe(2);
    });

    it("handles a server error page that is not JSON", async () => {
      let scrobbleTries = 0;
      const api = fakeLastfm(call => {
        if (call.method === "track.scrobble" && scrobbleTries++ === 0) return { status: 503 };
        return okReply(call);
      });
      const { internals } = start();

      await playThrough(internals, 0, 100);
      await vi.advanceTimersByTimeAsync(31 * 1000);
      expect(api.count("track.scrobble")).toBe(2);
    });

    it("does not reject when offline and not signed in", async () => {
      const unhandled = vi.fn();
      process.on("unhandledRejection", unhandled);
      try {
        const api = fakeLastfm(() => ({ network: true }));
        const { internals } = start({ sessionKey: null });

        await expect(internals.updatePlayerState(track({ videoProgress: 1 }))).resolves.toBeUndefined();
        await playThrough(internals, 0, 100);
        expect(api.count("auth.gettoken")).toBe(1);
        expect(electronMock.openExternal).not.toHaveBeenCalled();
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off("unhandledRejection", unhandled);
      }
    });
  });

  describe("connecting", () => {
    it("opens the sign in page once and stops polling once signed in", async () => {
      let polls = 0;
      const api = fakeLastfm(call => (call.method === "auth.getSession" && polls++ < 3 ? unauthorized : okReply(call)));
      const { lastFm, internals, sets } = start({ sessionKey: null });

      lastFm.connect();
      await playThrough(internals, 0, 120);
      lastFm.connect();
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(electronMock.openExternal).toHaveBeenCalledTimes(1);
      expect(api.count("auth.gettoken")).toBe(1);
      expect(api.count("auth.getSession")).toBe(4);
      expect(sets).toContainEqual(["lastfm.sessionKey", hex("session")]);
      expect(api.count("track.scrobble")).toBe(1);
    });

    it("stops when the token expires", async () => {
      const api = fakeLastfm(call => (call.method === "auth.getSession" ? { status: 403, body: { error: 15, message: "Token expired" } } : okReply(call)));
      start({ sessionKey: null });

      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(electronMock.openExternal).toHaveBeenCalledTimes(1);
      expect(api.count("auth.getSession")).toBe(1);
    });

    it("gives up after an hour without approval", async () => {
      const api = fakeLastfm(call => (call.method === "auth.getSession" ? unauthorized : okReply(call)));
      start({ sessionKey: null });

      await vi.advanceTimersByTimeAsync(61 * 60 * 1000);
      const polls = api.count("auth.getSession");
      expect(polls).toBeGreaterThan(5);
      expect(polls).toBeLessThan(150);
      await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
      expect(api.count("auth.getSession")).toBe(polls);
      expect(electronMock.openExternal).toHaveBeenCalledTimes(1);
    });

    it("stops polling when turned off", async () => {
      const api = fakeLastfm(call => (call.method === "auth.getSession" ? unauthorized : okReply(call)));
      const { lastFm } = start({ sessionKey: null });

      await vi.advanceTimersByTimeAsync(4 * 1000);
      const polls = api.count("auth.getSession");
      expect(polls).toBe(1);
      lastFm.disable();
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(api.count("auth.getSession")).toBe(polls);
    });

    it("reuses a stored token before asking for a new one", async () => {
      const api = fakeLastfm(okReply);
      const { sets } = start({ sessionKey: null, token: hex("stored") });

      await vi.advanceTimersByTimeAsync(1000);
      expect(api.count("auth.gettoken")).toBe(0);
      expect(api.calls[0].params.get("token")).toBe("stored");
      expect(electronMock.openExternal).not.toHaveBeenCalled();
      expect(sets).toContainEqual(["lastfm.sessionKey", hex("session")]);
    });
  });
});
