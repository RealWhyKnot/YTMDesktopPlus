import { afterEach, describe, expect, it, vi } from "vitest";
import DiscordPresence, { type PresenceButtonsProvider } from "../src/main/integrations/discord-presence";
import { VideoState, type PlayerState } from "../src/main/player-state-store";

// The buttons discord shows on the presence. Discord renders at most two
// buttons and only http(s) urls; anything else silently drops the whole
// activity frame, so both limits are part of the contract here.

type Buttons = { label: string; url: string }[] | undefined;

function buildButtons(providers: PresenceButtonsProvider[], listenAlongUrl = "https://ytmdesktopplus.com/p/abc123?t=60"): Buttons {
  const presence = new DiscordPresence();
  for (const provider of providers) {
    presence.registerButtonsProvider(provider);
  }
  return (presence as unknown as { buildButtons(url: string): Buttons }).buildButtons(listenAlongUrl);
}

describe("buildButtons", () => {
  it("shows nothing without providers or when providers decline", () => {
    expect(buildButtons([])).toBeUndefined();
    expect(buildButtons([() => undefined, () => []])).toBeUndefined();
  });

  it("passes the current track link through to providers", () => {
    const buttons = buildButtons([url => [{ label: "Listen Along", url }]], "https://ytmdesktopplus.com/p/abc123?t=60");
    expect(buttons).toEqual([{ label: "Listen Along", url: "https://ytmdesktopplus.com/p/abc123?t=60" }]);
  });

  it("drops non-http urls and caps the result at two buttons", () => {
    const buttons = buildButtons([
      () => [
        { label: "Bad", url: "ytmdplus://room/abcdefgh" },
        { label: "One", url: "https://ytmdesktopplus.com/r/abcdefgh" },
        { label: "Two", url: "https://ytmdesktopplus.com/p/abc123" },
        { label: "Three", url: "https://ytmdesktopplus.com/" }
      ]
    ]);
    expect(buttons).toEqual([
      { label: "One", url: "https://ytmdesktopplus.com/r/abcdefgh" },
      { label: "Two", url: "https://ytmdesktopplus.com/p/abc123" }
    ]);
  });

  it("contains a throwing provider and keeps the rest", () => {
    const buttons = buildButtons([
      () => {
        throw new Error("provider blew up");
      },
      () => [{ label: "Join Room", url: "https://ytmdesktopplus.com/r/abcdefgh" }]
    ]);
    expect(buttons).toEqual([{ label: "Join Room", url: "https://ytmdesktopplus.com/r/abcdefgh" }]);
  });

  it("unregisters a provider through the returned handle", () => {
    const presence = new DiscordPresence();
    const unsubscribe = presence.registerButtonsProvider(() => [{ label: "One", url: "https://ytmdesktopplus.com/" }]);
    unsubscribe();
    const buttons = (presence as unknown as { buildButtons(url: string): Buttons }).buildButtons("https://ytmdesktopplus.com/p/abc123");
    expect(buttons).toBeUndefined();
  });
});

function playingState(): PlayerState {
  return {
    videoDetails: {
      album: "Album",
      albumId: "MPREb_album",
      author: "Author",
      channelId: "UCchannel",
      durationSeconds: 200,
      thumbnails: [{ url: "https://example.invalid/art.jpg", width: 60, height: 60 }],
      title: "Title",
      id: "videoid1234",
      isLive: false
    },
    videoProgress: 12,
    trackState: VideoState.Playing,
    hasFullMetadata: true,
    adPlaying: false
  } as PlayerState;
}

function pausedState(): PlayerState {
  return { ...playingState(), trackState: VideoState.Paused };
}

type PresenceHarness = {
  presence: DiscordPresence;
  calls: { set: number; clear: number };
  settings: { listenAlongRoomsEnabled: boolean; discordPresenceHideOnPause: boolean };
  stateChanged(state: PlayerState): void;
};

function makePresence(settings: Partial<PresenceHarness["settings"]> = {}): PresenceHarness {
  const calls = { set: 0, clear: 0 };
  const resolved = { listenAlongRoomsEnabled: false, discordPresenceHideOnPause: false, ...settings };
  const presence = new DiscordPresence();
  presence.provide({ get: () => resolved } as never, { get: () => null } as never);
  Object.assign(presence, {
    ready: true,
    discordClient: {
      setActivity: () => calls.set++,
      clearActivity: () => calls.clear++
    }
  });
  return {
    presence,
    calls,
    settings: resolved,
    stateChanged: state => (presence as unknown as { playerStateChanged(state: PlayerState): void }).playerStateChanged(state)
  };
}

describe("activity updates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // A room opening at launch refreshes the activity before any track has
  // loaded. That refresh must not become the last one of the session.
  it("still reports playback after a refresh with no track loaded", () => {
    vi.useFakeTimers();
    const calls = { set: 0, clear: 0 };
    const presence = new DiscordPresence();
    presence.provide({ get: () => ({ listenAlongRoomsEnabled: false }) } as never, { get: () => null } as never);
    Object.assign(presence, {
      ready: true,
      discordClient: {
        setActivity: () => calls.set++,
        clearActivity: () => calls.clear++
      }
    });

    presence.refreshActivity();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 0, clear: 1 });

    (presence as unknown as { playerStateChanged(state: PlayerState): void }).playerStateChanged(playingState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 1, clear: 1 });
  });

  it("keeps the paused badge and clears after 30 seconds by default", () => {
    vi.useFakeTimers();
    const { calls, stateChanged } = makePresence();

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    stateChanged(pausedState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 2, clear: 0 });

    vi.advanceTimersByTime(30_000);
    expect(calls.clear).toBe(1);
  });

  it("clears on pause when hide-on-pause is on", () => {
    vi.useFakeTimers();
    const { calls, stateChanged } = makePresence({ discordPresenceHideOnPause: true });

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 1, clear: 0 });

    stateChanged(pausedState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 1, clear: 1 });
  });

  it("restores the activity on resume after a hidden pause", () => {
    vi.useFakeTimers();
    const { calls, stateChanged } = makePresence({ discordPresenceHideOnPause: true });

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    stateChanged(pausedState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 1, clear: 1 });

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 2, clear: 1 });
  });

  it("clears through refreshActivity when the setting turns on while paused", () => {
    vi.useFakeTimers();
    const { presence, calls, settings, stateChanged } = makePresence();

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    stateChanged(pausedState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 2, clear: 0 });

    settings.discordPresenceHideOnPause = true;
    presence.refreshActivity();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 2, clear: 1 });
  });
});
