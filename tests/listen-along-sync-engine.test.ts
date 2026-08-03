import { describe, expect, it } from "vitest";
import {
  BREAKER_SEEKS,
  DRIFT_DEADBAND_S,
  JUMP_MIN_SEEK_INTERVAL_MS,
  MIN_SEEK_INTERVAL_MS,
  SEEK_SETTLE_MS,
  decide,
  projectProgress
} from "../src/main/integrations/listen-along/sync-engine";
import type { Sample, SyncContext } from "../src/main/integrations/listen-along/types";
import { VideoState } from "../src/main/player-state-store";

const NOW = 1754236800000;

function sample(overrides: Partial<Sample> = {}): Sample {
  return {
    videoId: "abc123",
    durationSeconds: 200,
    progress: 60,
    trackState: VideoState.Playing,
    adPlaying: false,
    asOfMs: NOW,
    ...overrides
  };
}

function context(overrides: Partial<SyncContext> = {}): SyncContext {
  return {
    remote: sample(),
    local: sample(),
    previousLocal: sample(),
    nowMs: NOW,
    phase: "synced",
    lastSeekAtMs: null,
    lastRemoteUpdateMs: NOW,
    seekTimestamps: [],
    expectations: [],
    ...overrides
  };
}

const kinds = (result: { decisions: { kind: string }[] }) => result.decisions.map(decision => decision.kind);

// The settle blackout runs before the jump check, so a lower jump floor would
// never be reachable.
it("keeps the jump floor above the settle window", () => {
  expect(JUMP_MIN_SEEK_INTERVAL_MS).toBeGreaterThan(SEEK_SETTLE_MS);
});

describe("projectProgress", () => {
  it("advances a playing sample by its age", () => {
    expect(projectProgress(sample({ progress: 60, asOfMs: NOW - 3000 }), NOW)).toBeCloseTo(63);
  });

  it("holds a paused sample still", () => {
    expect(projectProgress(sample({ progress: 60, asOfMs: NOW - 3000, trackState: VideoState.Paused }), NOW)).toBe(60);
  });

  it("holds a sample that is on an ad", () => {
    expect(projectProgress(sample({ progress: 60, asOfMs: NOW - 3000, adPlaying: true }), NOW)).toBe(60);
  });
});

describe("decide", () => {
  it("does nothing when the two sides agree", () => {
    expect(kinds(decide(context()))).toEqual([]);
  });

  // Both sides quantize progress to about a second, so only projecting both
  // onto one clock exposes the real difference.
  it("measures drift from both projections, not raw progress", () => {
    const result = decide(
      context({
        remote: sample({ progress: 60, asOfMs: NOW - 4000 }),
        local: sample({ progress: 60, asOfMs: NOW })
      })
    );
    expect(result.decisions).toEqual([{ kind: "seek", seconds: expect.closeTo(64.3, 1) }]);
  });

  it("ignores drift inside the dead band", () => {
    const result = decide(
      context({
        remote: sample({ progress: 60 + DRIFT_DEADBAND_S - 0.1 }),
        local: sample({ progress: 60 })
      })
    );
    expect(kinds(result)).toEqual([]);
  });

  it("waits out the seek interval for ordinary drift", () => {
    const drifted = { remote: sample({ progress: 63 }), local: sample({ progress: 60 }) };

    expect(kinds(decide(context({ ...drifted, lastSeekAtMs: NOW - SEEK_SETTLE_MS - 100 })))).toEqual([]);
    expect(kinds(decide(context({ ...drifted, lastSeekAtMs: NOW - MIN_SEEK_INTERVAL_MS })))).toEqual(["seek"]);
  });

  it("corrects a jump without waiting out the full interval", () => {
    const jumped = { remote: sample({ progress: 120 }), local: sample({ progress: 60 }) };

    expect(kinds(decide(context({ ...jumped, lastSeekAtMs: NOW - JUMP_MIN_SEEK_INTERVAL_MS })))).toEqual(["seek"]);
    expect(kinds(decide(context({ ...jumped, lastSeekAtMs: NOW - 500 })))).toEqual([]);
  });

  it("clamps the seek target inside the track", () => {
    const result = decide(
      context({
        remote: sample({ progress: 400, durationSeconds: 400 }),
        local: sample({ progress: 60, durationSeconds: 200 })
      })
    );
    expect(result.decisions).toEqual([{ kind: "seek", seconds: 199 }]);
  });

  // The regression guard for the seek/rebuffer feedback loop: a correction
  // stalls local progress, which would otherwise read as fresh drift.
  it("issues nothing inside the settle window whatever the drift", () => {
    for (const progress of [62, 90, 180]) {
      const result = decide(
        context({
          remote: sample({ progress }),
          local: sample({ progress: 60 }),
          lastSeekAtMs: NOW - SEEK_SETTLE_MS + 1
        })
      );
      expect(kinds(result)).toEqual([]);
    }
  });

  it("does not seek while buffering", () => {
    const result = decide(
      context({
        remote: sample({ progress: 120 }),
        local: sample({ progress: 60, trackState: VideoState.Buffering })
      })
    );
    expect(kinds(result)).toEqual([]);
  });

  it("does not seek near the end of the track", () => {
    const result = decide(
      context({
        remote: sample({ progress: 120 }),
        local: sample({ progress: 199 })
      })
    );
    expect(kinds(result)).toEqual([]);
  });

  it("stops correcting when the host has gone quiet", () => {
    const result = decide(
      context({
        remote: sample({ progress: 120, asOfMs: NOW - 30000 }),
        local: sample({ progress: 60 }),
        lastRemoteUpdateMs: NOW - 30000
      })
    );
    expect(kinds(result)).toEqual([]);
  });

  it("navigates when the host changes track", () => {
    const result = decide(
      context({
        remote: sample({ videoId: "new456", progress: 10 }),
        local: sample({ videoId: "abc123" }),
        previousLocal: sample({ videoId: "abc123" })
      })
    );
    expect(result.phase).toBe("loading");
    expect(result.decisions).toEqual([{ kind: "navigate", videoId: "new456" }]);
  });

  it("leaves the track cue alone while it loads", () => {
    const result = decide(
      context({
        remote: sample({ videoId: "new456" }),
        local: sample({ videoId: "abc123" }),
        previousLocal: sample({ videoId: "abc123" }),
        phase: "loading",
        expectations: [{ kind: "navigate", target: "new456", expiresAtMs: NOW + 1000 }]
      })
    );
    expect(kinds(result)).toEqual([]);
  });

  it("holds off on drift corrections until the load finishes", () => {
    const result = decide(
      context({
        remote: sample({ progress: 120 }),
        local: sample({ progress: 60 }),
        phase: "loading"
      })
    );
    expect(kinds(result)).toEqual([]);
  });

  it("mirrors a pause and a resume", () => {
    const paused = decide(
      context({
        remote: sample({ trackState: VideoState.Paused }),
        local: sample({ trackState: VideoState.Playing })
      })
    );
    expect(kinds(paused)).toEqual(["pause"]);

    const resumed = decide(
      context({
        remote: sample({ trackState: VideoState.Playing }),
        local: sample({ trackState: VideoState.Paused }),
        previousLocal: sample({ trackState: VideoState.Paused })
      })
    );
    expect(kinds(resumed)).toEqual(["play"]);
  });

  it("pauses and ignores the remote sample while the host is on an ad", () => {
    const result = decide(
      context({
        remote: sample({ videoId: "advert", progress: 5, adPlaying: true }),
        local: sample({ videoId: "abc123", trackState: VideoState.Playing })
      })
    );
    expect(result.decisions).toEqual([{ kind: "pause" }]);
    expect(result.phase).toBe("idle");
  });

  it("issues nothing at all while a local ad plays", () => {
    const result = decide(
      context({
        remote: sample({ videoId: "new456", progress: 120 }),
        local: sample({ videoId: "abc123", progress: 60, adPlaying: true })
      })
    );
    expect(kinds(result)).toEqual([]);
  });

  it("resyncs hard once an ad clears", () => {
    const result = decide(
      context({
        remote: sample({ progress: 120 }),
        local: sample({ progress: 60 }),
        lastSeekAtMs: NOW - JUMP_MIN_SEEK_INTERVAL_MS
      })
    );
    expect(kinds(result)).toEqual(["seek"]);
  });

  it("pauses and idles when the host is playing nothing", () => {
    const result = decide(
      context({
        remote: sample({ videoId: null }),
        local: sample({ trackState: VideoState.Playing })
      })
    );
    expect(result.decisions).toEqual([{ kind: "pause" }]);
    expect(result.phase).toBe("idle");

    const settled = decide(
      context({
        remote: sample({ videoId: null }),
        local: sample({ trackState: VideoState.Paused })
      })
    );
    expect(kinds(settled)).toEqual([]);
  });

  it("treats a pause it did not issue as the user taking over", () => {
    const result = decide(
      context({
        remote: sample({ trackState: VideoState.Playing }),
        local: sample({ trackState: VideoState.Paused }),
        previousLocal: sample({ trackState: VideoState.Playing })
      })
    );
    expect(result.phase).toBe("suspended");
    expect(kinds(result)).toEqual(["suspend"]);
  });

  it("recognizes its own pause", () => {
    const result = decide(
      context({
        remote: sample({ trackState: VideoState.Playing }),
        local: sample({ trackState: VideoState.Paused }),
        previousLocal: sample({ trackState: VideoState.Playing }),
        expectations: [{ kind: "pause", expiresAtMs: NOW + 1000 }]
      })
    );
    expect(kinds(result)).toEqual(["play"]);
  });

  it("treats a track change it did not issue as the user taking over", () => {
    const result = decide(
      context({
        remote: sample({ videoId: "abc123" }),
        local: sample({ videoId: "other99" }),
        previousLocal: sample({ videoId: "abc123" })
      })
    );
    expect(result.phase).toBe("suspended");
  });

  it("recognizes its own track change", () => {
    const result = decide(
      context({
        remote: sample({ videoId: "other99" }),
        local: sample({ videoId: "other99" }),
        previousLocal: sample({ videoId: "abc123" })
      })
    );
    expect(kinds(result)).toEqual([]);
  });

  it("stays out of the way while suspended", () => {
    const result = decide(
      context({
        remote: sample({ progress: 180 }),
        local: sample({ progress: 10 }),
        phase: "suspended"
      })
    );
    expect(kinds(result)).toEqual([]);
    expect(result.phase).toBe("suspended");
  });

  it("rejoins when the user presses play again", () => {
    const result = decide(
      context({
        remote: sample({ progress: 120 }),
        local: sample({ progress: 10, trackState: VideoState.Playing }),
        previousLocal: sample({ progress: 10, trackState: VideoState.Paused }),
        phase: "suspended"
      })
    );
    expect(result.phase).toBe("synced");
    expect(kinds(result)).toEqual(["seek"]);
  });

  it("rejoins onto the host's track when it has moved on", () => {
    const result = decide(
      context({
        remote: sample({ videoId: "new456" }),
        local: sample({ videoId: "abc123", trackState: VideoState.Playing }),
        previousLocal: sample({ videoId: "abc123", trackState: VideoState.Paused }),
        phase: "suspended"
      })
    );
    expect(result.phase).toBe("loading");
    expect(result.decisions).toEqual([{ kind: "navigate", videoId: "new456" }]);
  });

  // The backstop for a sync that will not settle, including two instances
  // following each other.
  it("suspends rather than seeking forever", () => {
    const seekTimestamps = Array.from({ length: BREAKER_SEEKS }, (_, index) => NOW - index * 1000);
    const result = decide(
      context({
        remote: sample({ progress: 120 }),
        local: sample({ progress: 60 }),
        lastSeekAtMs: NOW - JUMP_MIN_SEEK_INTERVAL_MS,
        seekTimestamps
      })
    );
    expect(result.phase).toBe("suspended");
    expect(kinds(result)).toEqual(["suspend"]);
  });

  it("counts only seeks inside the breaker window", () => {
    const seekTimestamps = Array.from({ length: BREAKER_SEEKS }, (_, index) => NOW - 120000 - index * 1000);
    const result = decide(
      context({
        remote: sample({ progress: 120 }),
        local: sample({ progress: 60 }),
        lastSeekAtMs: NOW - JUMP_MIN_SEEK_INTERVAL_MS,
        seekTimestamps
      })
    );
    expect(kinds(result)).toEqual(["seek"]);
  });

  it("waits for a sample from each side", () => {
    expect(kinds(decide(context({ remote: null })))).toEqual([]);
    expect(kinds(decide(context({ local: null })))).toEqual([]);
  });
});
