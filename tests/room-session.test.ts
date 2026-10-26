import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ANCHOR_REFRESH_MS,
  OUTDATED_APP_ERROR,
  ROOM_RETURN_GRACE_MS,
  RoomSession,
  type RelayTransport,
  type RoomSnapshot
} from "../src/main/integrations/listen-along/room-session";
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
  const cancelCue = vi.fn();
  let cueResult: Promise<"seeked"> = Promise.resolve("seeked");
  const snapshots: RoomSnapshot[] = [];
  const logs: string[] = [];
  const clients: Array<{ handlers: RelayHandlers; roomId: string | null; connected: boolean; closed: boolean }> = [];

  const session = new RoomSession({
    createClient(handlers, roomId) {
      const entry = { handlers, roomId, connected: false, closed: false };
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
      return cueResult;
    },
    cancelCue,
    sendCommand: (command, value) => commands.push([command, value]),
    publish: snapshot => snapshots.push(snapshot),
    getPlayerState: () => playerState(null, VideoState.Unknown),
    now: () => nowMs,
    log: message => logs.push(message)
  });

  return {
    session,
    logs,
    sentFrames,
    commands,
    cues,
    cancelCue,
    holdCues() {
      cueResult = new Promise(() => {});
    },
    snapshots,
    clients,
    now() {
      return nowMs;
    },
    states() {
      return sentFrames.filter(frame => (frame as { t: string }).t === "s") as Array<{ t: "s"; v: string; a: number; p: 0 | 1 }>;
    },
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

  afterEach(() => {
    h.session.destroy();
    vi.useRealTimers();
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

  it("logs why the relay connection closed", () => {
    vi.useFakeTimers();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.current().handlers.onClose("1006 (socket hang up)");
    expect(h.logs).toContain("Room connection closed: 1006 (socket hang up)");
    vi.useRealTimers();
  });

  it("pins a host's reconnect to the room it reclaims", () => {
    vi.useFakeTimers();
    expect(h.current().roomId).toBeNull();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.current().handlers.onClose();
    vi.advanceTimersByTime(1000);
    expect(h.clients).toHaveLength(2);
    expect(h.current().roomId).toBe("abcdefgh");
    vi.useRealTimers();
  });

  it("adopts a fresh room the relay hands back for a reclaim and drops the old room's people", () => {
    vi.useFakeTimers();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 1, c: 1 });
    h.current().handlers.onFrame({ t: "m", members: [{ u: "aaaaaa", r: 1, d: "Alice" }], h: "DJ" });
    h.session.setAudioStreamState(true, 2);
    h.current().handlers.onClose();
    vi.advanceTimersByTime(1000);
    h.current().handlers.onOpen();
    h.current().handlers.onFrame({ t: "r", r: "bcdefghj", k: "e".repeat(32), u: "bcdefg", role: 0, n: 0, c: 1 });

    const snapshot = h.lastSnapshot();
    expect(snapshot.phase).toBe("hosting");
    expect(snapshot.shareUrl).toBe("https://ytmdesktopplus.com/r/bcdefghj");
    expect(snapshot.members).toEqual([]);
    expect(snapshot.listenerCount).toBe(0);
    expect(snapshot.webListenerCount).toBe(0);
    expect(snapshot.audioStreaming).toBe(false);
    expect(h.session.hostCredentials).toEqual({ roomId: "bcdefghj", hostKey: "e".repeat(32) });
    expect(h.logs).toContain("Room could not be reclaimed, the relay opened a new one");

    h.current().handlers.onClose();
    vi.advanceTimersByTime(1000);
    expect(h.current().roomId).toBe("bcdefghj");
    vi.useRealTimers();
  });

  it("stops pinning a reconnect once the room's node has been unreachable for 30s", () => {
    vi.useFakeTimers();
    const wait = (ms: number) => {
      h.advance(ms);
      vi.advanceTimersByTime(ms);
    };
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.current().handlers.onClose();
    for (const delay of [1000, 2000, 4000, 8000]) {
      wait(delay);
      h.current().handlers.onClose();
    }
    wait(15000);
    expect(h.clients.map(client => client.roomId)).toEqual([null, "abcdefgh", "abcdefgh", "abcdefgh", "abcdefgh", null]);
    expect(h.logs.filter(line => line === "Room's server unreachable for 30s, reconnecting through any node")).toHaveLength(1);
    h.current().handlers.onOpen();
    expect(h.sentFrames[h.sentFrames.length - 1]).toEqual({ t: "h", r: "abcdefgh", k: HOST_KEY, d: "DJ" });

    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.current().handlers.onClose();
    wait(1000);
    expect(h.current().roomId).toBe("abcdefgh");
    vi.useRealTimers();
  });

  it("keeps the roster when the relay gives the same room back", () => {
    vi.useFakeTimers();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 1, c: 1 });
    h.current().handlers.onFrame({ t: "m", members: [{ u: "aaaaaa", r: 1, d: "Alice" }], h: "DJ" });
    h.current().handlers.onClose();
    vi.advanceTimersByTime(1000);
    h.current().handlers.onOpen();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 1, c: 1 });
    expect(h.lastSnapshot().members).toEqual([{ id: "aaaaaa", name: "Alice", role: 1 }]);
    vi.useRealTimers();
  });

  it("logs phase changes without the room id or key", () => {
    vi.useFakeTimers();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.current().handlers.onFrame({ t: "n", n: 3 });
    h.current().handlers.onClose();
    vi.advanceTimersByTime(1000);
    h.current().handlers.onOpen();
    h.current().handlers.onFrame({ t: "r", r: "bcdefghj", k: "e".repeat(32), u: "bcdefg", role: 0, n: 0, c: 1 });
    vi.useRealTimers();

    expect(h.logs).toEqual([
      "Room connecting",
      "Room hosting",
      "Room connection closed: unknown",
      "Room connecting",
      "Room could not be reclaimed, the relay opened a new one",
      "Room hosting"
    ]);
    for (const line of h.logs) {
      expect(line).not.toContain("abcdefgh");
      expect(line).not.toContain(HOST_KEY);
    }
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

  // A reconnect lands mid-room, and the next roster change can be minutes
  // away; the welcome frame already carries the count, so take it.
  it("takes the count from the welcome frame", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 4, c: 1 });
    expect(h.lastSnapshot().listenerCount).toBe(4);
  });

  it("stamps anchors in server time, measured across the hello round trip", () => {
    const helloAt = h.now();
    h.advance(200);
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: helloAt + 100 + 5_000 });
    h.session.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 10));

    expect(h.session.serverClockOffsetMs).toBe(5_000);
    expect(h.states().at(-1)).toEqual({ t: "s", v: "dQw4w9WgXcQ", a: h.now() + 5_000 - 10_000, p: 1 });
  });

  it("keeps the clock offset from the quickest round trip", () => {
    vi.useFakeTimers();
    const welcome = (rttMs: number, offsetMs: number) => {
      h.current().handlers.onOpen();
      const sentAt = h.now();
      h.advance(rttMs);
      h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: sentAt + rttMs / 2 + offsetMs });
    };
    const reconnect = () => {
      h.current().handlers.onClose();
      vi.advanceTimersByTime(1000);
    };

    welcome(200, 5_000);
    expect(h.session.serverClockOffsetMs).toBe(5_000);
    reconnect();
    welcome(2_000, 6_000);
    expect(h.session.serverClockOffsetMs).toBe(5_000);
    reconnect();
    welcome(40, 5_200);
    expect(h.session.serverClockOffsetMs).toBe(5_200);
  });

  it("has no server clock until the relay has answered", () => {
    expect(h.session.serverClockOffsetMs).toBeNull();
  });

  it("repeats its anchor every 30s while hosting, and stops once the connection drops", () => {
    vi.useFakeTimers();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.session.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 10));
    expect(h.states()).toHaveLength(1);

    vi.advanceTimersByTime(ANCHOR_REFRESH_MS);
    expect(h.states()).toHaveLength(2);
    expect(h.states()[1]).toEqual(h.states()[0]);

    h.current().handlers.onClose();
    vi.advanceTimersByTime(ANCHOR_REFRESH_MS - 1000);
    expect(h.states()).toHaveLength(2);
  });

  it("fails with a clear message when a newer relay rejects its frames", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1, v: 2 });

    h.current().handlers.onFrame({ t: "e", m: "bad frame" });

    expect(h.lastSnapshot().phase).toBe("failed");
    expect(h.lastSnapshot().error).toBe(OUTDATED_APP_ERROR);
    expect(h.current().closed).toBe(true);
  });

  it("shows a bad frame from a relay on its own version without giving up", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1, v: 1 });

    h.current().handlers.onFrame({ t: "e", m: "bad frame" });

    expect(h.lastSnapshot().phase).toBe("hosting");
    expect(h.current().closed).toBe(false);
  });

  it("redials at once when told to, keeping the room", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });

    h.session.reconnectNow();

    expect(h.clients).toHaveLength(2);
    expect(h.clients[0].closed).toBe(true);
    expect(h.current().roomId).toBe("abcdefgh");
    expect(h.lastSnapshot().phase).toBe("connecting");
    h.current().handlers.onOpen();
    expect(h.sentFrames.at(-1)).toEqual({ t: "h", r: "abcdefgh", k: HOST_KEY, d: "DJ" });
  });

  it("carries the audio issue in the snapshot", () => {
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", k: HOST_KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    h.session.setAudioStreamState(false, 0, "retrying");
    expect(h.lastSnapshot().audioIssue).toBe("retrying");
    h.session.setAudioStreamState(true, 1, null);
    expect(h.lastSnapshot().audioIssue).toBeNull();
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

  it("keeps listener connections unpinned", () => {
    vi.useFakeTimers();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", u: "aaaaaa", role: 0, n: 1, c: 1 });
    h.current().handlers.onClose();
    vi.advanceTimersByTime(1000);
    expect(h.clients.map(client => client.roomId)).toEqual([null, null]);
    vi.useRealTimers();
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

  it("fails at once when the room does not exist on the first join", () => {
    h.current().handlers.onFrame({ t: "e", m: "no such room" });
    expect(h.lastSnapshot().phase).toBe("failed");
    expect(h.lastSnapshot().error).toBe("no such room");
  });

  it("waits up to 30s for a room it was already in to come back", () => {
    vi.useFakeTimers();
    try {
      const wait = (ms: number) => {
        h.advance(ms);
        vi.advanceTimersByTime(ms);
      };
      h.current().handlers.onFrame({ t: "r", r: "abcdefgh", u: "aaaaaa", role: 0, n: 1, c: 1 });
      h.current().handlers.onClose();
      wait(1000);
      h.current().handlers.onOpen();
      h.current().handlers.onFrame({ t: "e", m: "no such room" });

      expect(h.lastSnapshot().phase).toBe("connecting");
      expect(h.clients[1].closed).toBe(true);
      wait(2000);
      expect(h.clients).toHaveLength(3);
      h.current().handlers.onOpen();
      h.current().handlers.onFrame({ t: "r", r: "abcdefgh", u: "aaaaaa", role: 0, n: 1, c: 1 });
      expect(h.lastSnapshot().phase).toBe("listening");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up on a room that stays gone past the grace period", () => {
    vi.useFakeTimers();
    try {
      h.current().handlers.onFrame({ t: "r", r: "abcdefgh", u: "aaaaaa", role: 0, n: 1, c: 1 });
      h.current().handlers.onClose();
      vi.advanceTimersByTime(1000);
      h.current().handlers.onOpen();
      h.current().handlers.onFrame({ t: "e", m: "no such room" });

      h.advance(ROOM_RETURN_GRACE_MS);
      vi.runOnlyPendingTimers();
      h.current().handlers.onOpen();
      h.current().handlers.onFrame({ t: "e", m: "no such room" });

      expect(h.lastSnapshot().phase).toBe("failed");
      expect(h.lastSnapshot().error).toBe("no such room");
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels its own pending track cue when it leaves", () => {
    h.holdCues();
    h.current().handlers.onFrame({ t: "r", r: "abcdefgh", u: "aaaaaa", role: 0, n: 1, c: 1_754_236_800_000 });
    h.session.updateLocalState(playerState("localvideo1", VideoState.Playing, 5));
    h.advance(300);
    h.current().handlers.onFrame({ t: "s", v: "dQw4w9WgXcQ", a: 1_754_236_800_000 - 42_000, p: 1, c: 1_754_236_800_300 });
    expect(h.cues).toHaveLength(1);

    h.session.leave();

    expect(h.cancelCue).toHaveBeenCalledTimes(1);
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
