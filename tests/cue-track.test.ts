import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTrackCue, LOAD_TIMEOUT_MS, SETTLE_MS, VERIFY_MS, type CueDeps } from "../src/main/playback/cue-track";
import { VideoState, type PlayerState } from "../src/main/player-state-store";

const NOW = 1754236800000;

function playerState(overrides: Partial<PlayerState> & { id?: string; durationSeconds?: number } = {}): PlayerState {
  const { id = "abc123", durationSeconds = 200, ...rest } = overrides;
  return {
    videoDetails: {
      album: "",
      albumId: "",
      author: "",
      channelId: "",
      durationSeconds,
      thumbnails: [],
      title: "",
      id,
      likeStatus: -1,
      videoType: 0,
      isLive: false
    },
    playlistId: "",
    trackState: VideoState.Playing,
    queue: null,
    videoProgress: 0,
    volume: 100,
    muted: false,
    adPlaying: false,
    hasFullMetadata: true,
    ...rest
  } as PlayerState;
}

function harness(initial: PlayerState | null = null) {
  const listeners = new Set<(state: PlayerState) => void>();
  const sent: { command: string; value?: unknown }[] = [];
  let state = initial;
  let now = NOW;
  let viewAvailable = true;

  const deps: CueDeps = {
    getState: () => state,
    addEventListener: listener => listeners.add(listener),
    removeEventListener: listener => listeners.delete(listener),
    send: (command, value) => {
      if (!viewAvailable) return false;
      sent.push({ command, value });
      return true;
    },
    now: () => now
  };

  return {
    deps,
    sent,
    listenerCount: () => listeners.size,
    setViewAvailable: (available: boolean) => (viewAvailable = available),
    advanceClock: (ms: number) => (now += ms),
    emit(next: PlayerState) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    }
  };
}

// A live anchor 60s old against a 200s track resolves to position 60.
const anchor = { kind: "anchor" as const, epochMs: NOW - 60_000 };

describe("createTrackCue", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("seeks without navigating when already on the loaded target", async () => {
    const h = harness(playerState());
    const result = createTrackCue(h.deps).cue({ videoId: "abc123", anchor });

    expect(h.sent).toEqual([{ command: "seekTo", value: 60 }]);
    h.emit(playerState({ videoProgress: 60 }));
    await expect(result).resolves.toBe("seeked");
  });

  it("reports already-there when the target needs no seek", async () => {
    const h = harness(playerState());
    await expect(createTrackCue(h.deps).cue({ videoId: "abc123", anchor: null })).resolves.toBe("already-there");
    expect(h.sent).toEqual([]);
  });

  it("navigates then seeks once the target reports loaded", async () => {
    const h = harness(playerState({ id: "old999" }));
    const result = createTrackCue(h.deps).cue({ videoId: "abc123", anchor });

    expect(h.sent).toEqual([{ command: "navigate", value: { watchEndpoint: { videoId: "abc123", playlistId: undefined } } }]);

    h.emit(playerState({ id: "abc123" }));
    expect(h.sent).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(h.sent[1]).toEqual({ command: "seekTo", value: 60 });

    h.emit(playerState({ id: "abc123", videoProgress: 60 }));
    await expect(result).resolves.toBe("seeked");
  });

  it("waits for a usable duration before seeking", async () => {
    const h = harness(playerState({ id: "old999" }));
    createTrackCue(h.deps).cue({ videoId: "abc123", anchor });

    h.emit(playerState({ id: "abc123", durationSeconds: 0 }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(h.sent).toHaveLength(1);

    h.emit(playerState({ id: "abc123" }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(h.sent[1]).toEqual({ command: "seekTo", value: 60 });
  });

  it("does not seek while buffering or on an ad", async () => {
    const h = harness(playerState({ id: "old999" }));
    createTrackCue(h.deps).cue({ videoId: "abc123", anchor });

    h.emit(playerState({ id: "abc123", trackState: VideoState.Buffering }));
    h.emit(playerState({ id: "abc123", adPlaying: true }));
    h.emit(playerState({ id: "abc123", hasFullMetadata: false }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(h.sent).toHaveLength(1);
  });

  it("recomputes a live anchor across navigation latency", async () => {
    const h = harness(playerState({ id: "old999" }));
    createTrackCue(h.deps).cue({ videoId: "abc123", anchor });

    h.advanceClock(8000);
    h.emit(playerState({ id: "abc123" }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);

    expect(h.sent[1]).toEqual({ command: "seekTo", value: 68 });
  });

  it("skips the navigate when the target is loading already", async () => {
    const h = harness(playerState({ id: "abc123", hasFullMetadata: false }));
    createTrackCue(h.deps).cue({ videoId: "abc123", anchor });

    expect(h.sent).toEqual([]);

    h.emit(playerState({ id: "abc123" }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(h.sent).toEqual([{ command: "seekTo", value: 60 }]);
  });

  it("supersedes a pending cue", async () => {
    const h = harness(playerState({ id: "old999" }));
    const cue = createTrackCue(h.deps);

    const first = cue.cue({ videoId: "abc123", anchor });
    const second = cue.cue({ videoId: "def456", anchor });

    await expect(first).resolves.toBe("superseded");
    expect(h.sent[1]).toEqual({ command: "navigate", value: { watchEndpoint: { videoId: "def456", playlistId: undefined } } });

    h.emit(playerState({ id: "def456" }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    h.emit(playerState({ id: "def456", videoProgress: 60 }));
    await expect(second).resolves.toBe("seeked");
  });

  it("resolves cancel as superseded", async () => {
    const h = harness(playerState({ id: "old999" }));
    const cue = createTrackCue(h.deps);
    const result = cue.cue({ videoId: "abc123", anchor });

    cue.cancel();
    await expect(result).resolves.toBe("superseded");
    expect(h.listenerCount()).toBe(0);
  });

  it("times out when the target never loads", async () => {
    const h = harness(playerState({ id: "old999" }));
    const result = createTrackCue(h.deps).cue({ videoId: "abc123", anchor });

    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    await expect(result).resolves.toBe("timeout");
    expect(h.listenerCount()).toBe(0);
  });

  it("retries a seek that did not land, then gives up", async () => {
    const h = harness(playerState({ id: "old999" }));
    const result = createTrackCue(h.deps).cue({ videoId: "abc123", anchor });

    h.emit(playerState({ id: "abc123" }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(h.sent).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    expect(h.sent).toHaveLength(3);
    expect(h.sent[2].command).toBe("seekTo");

    await vi.advanceTimersByTimeAsync(VERIFY_MS);
    await expect(result).resolves.toBe("timeout");
    expect(h.sent).toHaveLength(3);
  });

  // A paused track emits no progress, so the seek cannot be confirmed.
  it("accepts an unconfirmed seek on a paused track", async () => {
    const h = harness(playerState({ id: "old999" }));
    const result = createTrackCue(h.deps).cue({ videoId: "abc123", anchor });

    h.emit(playerState({ id: "abc123", trackState: VideoState.Paused }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    await vi.advanceTimersByTimeAsync(VERIFY_MS * 2);

    await expect(result).resolves.toBe("seeked");
  });

  it("reports no-view when there is nothing to drive", async () => {
    const h = harness(playerState({ id: "old999" }));
    h.setViewAvailable(false);
    await expect(createTrackCue(h.deps).cue({ videoId: "abc123", anchor })).resolves.toBe("no-view");
  });

  it("navigates without waiting when there is no position to restore", async () => {
    const h = harness(playerState({ id: "old999" }));
    await expect(createTrackCue(h.deps).cue({ videoId: "abc123", anchor: null })).resolves.toBe("navigated");
    expect(h.listenerCount()).toBe(0);
  });

  it("passes a playlist through to the endpoint", async () => {
    const h = harness(playerState({ id: "old999" }));
    createTrackCue(h.deps).cue({ videoId: "abc123", playlistId: "PLxyz", anchor: null });
    expect(h.sent).toEqual([{ command: "navigate", value: { watchEndpoint: { videoId: "abc123", playlistId: "PLxyz" } } }]);
  });

  it("leaves no listener behind on any terminal result", async () => {
    const h = harness(playerState({ id: "old999" }));
    const cue = createTrackCue(h.deps);

    await cue.cue({ videoId: "abc123", anchor: null });
    expect(h.listenerCount()).toBe(0);

    const timedOut = cue.cue({ videoId: "abc123", anchor });
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    await timedOut;
    expect(h.listenerCount()).toBe(0);

    const seeked = cue.cue({ videoId: "abc123", anchor });
    h.emit(playerState({ id: "abc123" }));
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    h.emit(playerState({ id: "abc123", videoProgress: 60 }));
    await seeked;
    expect(h.listenerCount()).toBe(0);
  });
});
