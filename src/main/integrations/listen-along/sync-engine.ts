import { VideoState } from "../../player-state-store";
import type { Decision, Sample, SyncContext, SyncPhase } from "./types";

// Decides what to do with the local player to keep it alongside a remote one.
//
// Pure on purpose: every rule that keeps this from fighting itself lives here
// and is exercised by unit tests rather than by running two copies of the app.

// Both sides report progress about once a second, so a raw sample comparison
// carries a second of quantization error on its own. Projecting both onto the
// same clock removes that, leaving transport jitter of roughly 100-200ms as the
// floor. This dead band sits well above the floor and below what anyone in
// another room notices.
export const DRIFT_DEADBAND_S = 1.25;
// Only a host seek, an ad, or a stall moves things this far.
export const JUMP_THRESHOLD_S = 5;
// Steady state drift is clock drift, measured in parts per million. Correcting
// more often than this means something structural is wrong, which is what the
// breaker is for.
export const MIN_SEEK_INTERVAL_MS = 8000;
// A seek forces a rebuffer, during which local progress stalls and reads as
// fresh drift. Without this blackout that feeds straight back into another seek.
export const SEEK_SETTLE_MS = 2500;
// Floor for the jump path. Must stay above the settle window, otherwise the
// blackout swallows it and the floor never applies.
export const JUMP_MIN_SEEK_INTERVAL_MS = 3000;
// Land slightly ahead rather than behind, so the correction does not
// immediately re-trigger while the buffer fills.
export const SEEK_LEAD_MS = 300;
export const REMOTE_STALE_MS = 10000;
// Correcting this close to the end is pointless; the track is about to change.
export const END_GUARD_S = 3;
export const BREAKER_SEEKS = 6;
export const BREAKER_WINDOW_MS = 60000;

export type SyncResult = {
  decisions: Decision[];
  phase: SyncPhase;
};

export function projectProgress(sample: Sample, nowMs: number) {
  if (sample.trackState !== VideoState.Playing || sample.adPlaying) return sample.progress;
  return sample.progress + Math.max(0, nowMs - sample.asOfMs) / 1000;
}

function hasLiveExpectation(ctx: SyncContext, kind: string, target?: string | number) {
  return ctx.expectations.some(
    expectation => expectation.kind === kind && expectation.expiresAtMs > ctx.nowMs && (target === undefined || expectation.target === target)
  );
}

function recentSeeks(ctx: SyncContext) {
  return ctx.seekTimestamps.filter(at => ctx.nowMs - at < BREAKER_WINDOW_MS).length;
}

function seekTarget(remote: Sample, local: Sample, nowMs: number) {
  const lead = remote.trackState === VideoState.Playing && !remote.adPlaying ? SEEK_LEAD_MS / 1000 : 0;
  const wanted = projectProgress(remote, nowMs) + lead;
  const ceiling = Math.max(0, local.durationSeconds - 1);
  return Math.min(Math.max(wanted, 0), ceiling);
}

// The remote is on an ad, so its video and progress describe the ad rather than
// the music and none of it can be trusted.
function remoteIsMusic(remote: Sample) {
  return !remote.adPlaying && remote.videoId !== null;
}

export function decide(ctx: SyncContext): SyncResult {
  const { remote, local, nowMs, phase } = ctx;
  const stay = (next: SyncPhase = phase, decisions: Decision[] = []) => ({ decisions, phase: next });

  if (!remote || !local) return stay();
  // Anything issued now would act on the ad rather than the track.
  if (local.adPlaying) return stay();

  const remoteStale = ctx.lastRemoteUpdateMs !== null && nowMs - ctx.lastRemoteUpdateMs > REMOTE_STALE_MS;

  if (phase === "suspended") {
    const resumed = ctx.previousLocal !== null && ctx.previousLocal.trackState !== VideoState.Playing && local.trackState === VideoState.Playing;
    if (!resumed || remote.trackState !== VideoState.Playing || !remoteIsMusic(remote)) return stay();
    if (remote.videoId !== local.videoId) return stay("loading", [{ kind: "navigate", videoId: remote.videoId }]);
    return stay("synced", [{ kind: "seek", seconds: seekTarget(remote, local, nowMs) }]);
  }

  // The host is not listening to anything we can follow.
  if (!remoteIsMusic(remote)) {
    if (local.trackState === VideoState.Playing) return stay("idle", [{ kind: "pause" }]);
    return stay("idle");
  }

  // Once in sync, a local track change we did not ask for is the user steering.
  if (local.videoId !== null && local.videoId !== remote.videoId) {
    const weAskedForIt = hasLiveExpectation(ctx, "navigate", local.videoId);
    const wasInSync = ctx.previousLocal !== null && ctx.previousLocal.videoId === remote.videoId;
    if (wasInSync && !weAskedForIt) return stay("suspended", [{ kind: "suspend", reason: "You changed the track" }]);
  }

  if (remote.videoId !== local.videoId) {
    if (phase === "loading" && hasLiveExpectation(ctx, "navigate", remote.videoId)) return stay();
    return stay("loading", [{ kind: "navigate", videoId: remote.videoId }]);
  }

  // The track cue owns the seek until it has landed.
  if (phase === "loading") return stay();

  const decisions: Decision[] = [];

  const remotePlaying = remote.trackState === VideoState.Playing;
  const localPlaying = local.trackState === VideoState.Playing;
  if (remotePlaying !== localPlaying && local.trackState !== VideoState.Buffering) {
    if (!remotePlaying) {
      decisions.push({ kind: "pause" });
    } else if (local.trackState === VideoState.Paused) {
      const weAskedForIt = hasLiveExpectation(ctx, "pause") || hasLiveExpectation(ctx, "seek");
      // A pause we did not issue, while the host plays on, is the user.
      if (ctx.previousLocal !== null && ctx.previousLocal.trackState === VideoState.Playing && !weAskedForIt) {
        return stay("suspended", [{ kind: "suspend", reason: "You paused playback" }]);
      }
      decisions.push({ kind: "play" });
    }
  }

  if (remoteStale) return stay("synced", decisions);
  if (ctx.lastSeekAtMs !== null && nowMs - ctx.lastSeekAtMs < SEEK_SETTLE_MS) return stay("synced", decisions);
  if (local.trackState === VideoState.Buffering) return stay("synced", decisions);
  if (local.durationSeconds > 0 && projectProgress(local, nowMs) > local.durationSeconds - END_GUARD_S) return stay("synced", decisions);

  const drift = projectProgress(remote, nowMs) - projectProgress(local, nowMs);
  if (Math.abs(drift) < DRIFT_DEADBAND_S) return stay("synced", decisions);

  const sinceSeek = ctx.lastSeekAtMs === null ? Number.POSITIVE_INFINITY : nowMs - ctx.lastSeekAtMs;
  const isJump = Math.abs(drift) >= JUMP_THRESHOLD_S;
  const allowed = isJump ? sinceSeek >= JUMP_MIN_SEEK_INTERVAL_MS : sinceSeek >= MIN_SEEK_INTERVAL_MS;
  if (!allowed) return stay("synced", decisions);

  if (recentSeeks(ctx) + 1 > BREAKER_SEEKS) {
    return stay("suspended", [{ kind: "suspend", reason: "Sync is unstable" }]);
  }

  decisions.push({ kind: "seek", seconds: seekTarget(remote, local, nowMs) });
  return stay("synced", decisions);
}
