import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoomSession, type RelayTransport, type RoomSnapshot } from "../src/main/integrations/listen-along/room-session";
import type { RelayHandlers } from "../src/main/integrations/listen-along/relay-client";
import { VideoState, type PlayerState } from "../src/main/player-state-store";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

function playerState(videoId: string | null, trackState: VideoState, progress = 0): PlayerState {
  return makePlayerState({
    videoDetails: videoId ? makeVideoDetails({ id: videoId, durationSeconds: 300 }) : null,
    videoProgress: progress,
    trackState,
    hasFullMetadata: true
  });
}

function makeHarness() {
  let nowMs = 1_754_236_800_000;
  const sentFrames: unknown[] = [];
  const commands: Array<[string, unknown]> = [];
  const cues: Array<{ videoId: string }> = [];
  const snapshots: RoomSnapshot[] = [];
  const clients: Array<{ handlers: RelayHandlers; connected: boolean; closed: boolean }> = [];

  const session = new RoomSession({
    createClient(handlers) {
      const entry = { handlers, connected: false, closed: false };
      clients.push(entry);
      const transport: RelayTransport = {
        connect: () => {
          entry.connected = true;
        },
        send: frame => sentFrames.push(frame),
        close: () => {
          entry.closed = true;
        },
        isOpen: true
      };
      return transport;
    },
    cueTrack: request => {
      cues.push({ videoId: request.videoId });
      return Promise.resolve("seeked");
    },
    sendCommand: (command, value) => commands.push([command, value]),
    publish: snapshot => snapshots.push(snapshot),
    getPlayerState: () => playerState(null, VideoState.Unknown),
    now: () => nowMs
  });

  return {
    session,
    sentFrames,
    commands,
    cues,
    snapshots,
    clients,
    advance(ms: number) {
      nowMs += ms;
    },
    current() {
      return clients[clients.length - 1];
    },
    lastSnapshot() {
      return snapshots[snapshots.length - 1];
    }
  };
}

const HOST_KEY = "f".repeat(32);

describe("RoomSession hosting", () => {
  let h: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    h = makeHarness();
    h.session.host("DJ");
    h.current().handlers.onOpen();
  });

  it("creates a room with the display name and reports the share link", () => {
    expect(h.sentFrames[0]).toEqual({ t: "h", d: "DJ" });
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: h.lastSnapshot() ? 1 : 1 });
    const snapshot = h.lastSnapshot();
    expect(snapshot.phase).toBe("hosting");
    expect(snapshot.roomId).toBe("abcdefgh");
    expect(snapshot.shareUrl).toBe("https://ytmdesktopplus.com/r/abcdefgh");
    expect(snapshot.isHost).toBe(true);
  });

  it("publishes anchors only on meaningful change", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.session.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 10));
    const first = h.sentFrames.filter(frame => (frame as { t: string }).t === "s");
    expect(first).toHaveLength(1);

    // Steady playback: progress advances with the clock, anchor holds still.
    h.advance(5000);
    h.session.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 15));
    expect(h.sentFrames.filter(frame => (frame as { t: string }).t === "s")).toHaveLength(1);

    // A seek moves the anchor.
    h.advance(1000);
    h.session.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 100));
    expect(h.sentFrames.filter(frame => (frame as { t: string }).t === "s")).toHaveLength(2);

    // A pause flips p.
    h.advance(1000);
    h.session.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Paused, 100));
    const stateFrames = h.sentFrames.filter(frame => (frame as { t: string }).t === "s");
    expect(stateFrames).toHaveLength(3);
    expect((stateFrames[2] as { p: number }).p).toBe(0);
  });

  it("applies controller intents to the local player", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.current().handlers.onFrame({ t: "c", a: "seek", m: 42, u: "aaaaaa" });
    h.current().handlers.onFrame({ t: "c", a: "next", u: "aaaaaa" });
    h.current().handlers.onFrame({ t: "c", a: "track", v: "xyzxyzxyz", u: "aaaaaa" });
    expect(h.commands).toEqual([
      ["seekTo", 42],
      ["next", undefined]
    ]);
    expect(h.cues).toEqual([{ videoId: "xyzxyzxyz" }]);
  });

  it("reclaims the room with the stored key on reconnect", () => {
    vi.useFakeTimers();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.current().handlers.onClose();
    expect(h.lastSnapshot().phase).toBe("connecting");

    vi.advanceTimersByTime(1000);
    expect(h.clients).toHaveLength(2);
    h.current().handlers.onOpen();
    expect(h.sentFrames[h.sentFrames.length - 1]).toEqual({ t: "h", r: "abcdefgh", k: HOST_KEY, d: "DJ" });
    vi.useRealTimers();
  });

  it("keeps the roster and count from the relay", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.current().handlers.onFrame({ t: "m", members: [{ u: "aaaaaa", r: 1, d: "Alice" }], h: "DJ" });
    h.current().handlers.onFrame({ t: "n", n: 1 });
    const snapshot = h.lastSnapshot();
    expect(snapshot.members).toEqual([{ id: "aaaaaa", name: "Alice", role: 1 }]);
    expect(snapshot.hostName).toBe("DJ");
    expect(snapshot.listenerCount).toBe(1);
  });
});

describe("RoomSession listening", () => {
  let h: ReturnType<typeof makeHarness>;

  beforeEach(() => {
    h = makeHarness();
    h.session.join("abcdefgh", "Alice");
    h.current().handlers.onOpen();
  });

  it("joins with the display name and follows relayed state", () => {
    expect(h.sentFrames[0]).toEqual({ t: "j", r: "abcdefgh", d: "Alice" });
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", u: "aaaaaa", role: 0, n: 1, c: 1_754_236_800_000 });
    expect(h.lastSnapshot().phase).toBe("listening");

    // Local player is on another track; the relayed anchor should cue the
    // host's track.
    h.session.updateLocalState(playerState("localvideo1", VideoState.Playing, 5));
    h.advance(300);
    h.current().handlers.onFrame({ t: "s", v: "dQw4w9WgXcQ", a: 1_754_236_800_000 - 42_000, p: 1, c: 1_754_236_800_300 });
    expect(h.cues).toEqual([{ videoId: "dQw4w9WgXcQ" }]);
  });

  it("sends control intents when promoted", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", u: "aaaaaa", role: 0, n: 1, c: 1 });
    h.current().handlers.onFrame({ t: "role", r: 1 });
    expect(h.lastSnapshot().role).toBe(1);

    h.session.control("pause");
    h.session.control("seek", 90);
    const controls = h.sentFrames.filter(frame => (frame as { t: string }).t === "c");
    expect(controls).toEqual([
      { t: "c", a: "pause" },
      { t: "c", a: "seek", m: 90 }
    ]);
  });

  it("treats fatal relay errors as terminal", () => {
    h.current().handlers.onFrame({ t: "e", m: "room full" });
    expect(h.lastSnapshot().phase).toBe("failed");
    expect(h.lastSnapshot().error).toBe("room full");

    // The close that follows must not schedule a reconnect.
    vi.useFakeTimers();
    h.current().handlers.onClose();
    vi.advanceTimersByTime(60_000);
    expect(h.clients).toHaveLength(1);
    vi.useRealTimers();
  });

  it("leave resets to idle and tells the relay", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", u: "aaaaaa", role: 0, n: 1, c: 1 });
    h.session.leave();
    expect(h.sentFrames[h.sentFrames.length - 1]).toEqual({ t: "x" });
    const snapshot = h.lastSnapshot();
    expect(snapshot.phase).toBe("idle");
    expect(snapshot.roomId).toBeNull();
    expect(h.current().closed).toBe(true);
  });
});
