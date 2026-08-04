import { afterEach, describe, expect, it, vi } from "vitest";
import DiscordPresence from "../src/main/integrations/discord-presence";
import { VideoState, type PlayerState } from "../src/main/player-state-store";
import type { RoomSnapshot } from "../src/shared/room-protocol";

// The buttons discord shows on the presence. Discord only renders http(s)
// button urls and silently drops the whole activity frame otherwise, so the
// url scheme is part of the contract here, not a formatting detail.

type Buttons = { label: string; url: string }[] | undefined;

function buildButtons(roomsEnabled: boolean, room: Partial<RoomSnapshot> | null, listenAlongUrl = "https://ytmdesktopplus.com/p/abc123?t=60"): Buttons {
  const presence = new DiscordPresence();
  presence.provide({ get: () => ({ listenAlongRoomsEnabled: roomsEnabled }) } as never, { get: () => room } as never);
  return (presence as unknown as { buildButtons(url: string): Buttons }).buildButtons(listenAlongUrl);
}

describe("buildButtons", () => {
  it("returns no buttons when the master toggle is off", () => {
    expect(buildButtons(false, null)).toBeUndefined();
    expect(buildButtons(false, { phase: "hosting", shareUrl: "https://ytmdesktopplus.com/r/abcdefgh" })).toBeUndefined();
  });

  it("offers no buttons at all without a live room", () => {
    expect(buildButtons(true, null)).toBeUndefined();
    expect(buildButtons(true, { phase: "listening", shareUrl: "https://ytmdesktopplus.com/r/abcdefgh" })).toBeUndefined();
    expect(buildButtons(true, { phase: "connecting" })).toBeUndefined();
  });

  it("shows the room link first while hosting", () => {
    expect(buildButtons(true, { phase: "hosting", shareUrl: "https://ytmdesktopplus.com/r/abcdefgh" })).toEqual([
      { label: "Join Room", url: "https://ytmdesktopplus.com/r/abcdefgh" },
      { label: "Listen Along", url: "https://ytmdesktopplus.com/p/abc123?t=60" }
    ]);
  });

  it("only ever emits http(s) urls", () => {
    const buttons = buildButtons(true, { phase: "hosting", shareUrl: "https://ytmdesktopplus.com/r/abcdefgh" }) ?? [];
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button.url.startsWith("https://")).toBe(true);
    }
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
});
