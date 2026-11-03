import { VideoState } from "../../player-state-store";
import type { Decision, Sample, SyncContext, SyncPhase } from "./types";

export const DRIFT_DEADBAND_S = 1.25;

export const JUMP_THRESHOLD_S = 5;

export const MIN_SEEK_INTERVAL_MS = 8000;

export const SEEK_SETTLE_MS = 2500;

export const JUMP_MIN_SEEK_INTERVAL_MS = 3000;

export const SEEK_LEAD_MS = 300;
export const REMOTE_STALE_MS = 10000;

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
    (expectation) => expectation.kind === kind && expectation.expiresAtMs > ctx.nowMs && (target === undefined || expectation.target === target)
  );
}

function recentSeeks(ctx: SyncContext) {
  return ctx.seekTimestamps.filter((at) => ctx.nowMs - at < BREAKER_WINDOW_MS).length;
}

function seekTarget(remote: Sample, local: Sample, nowMs: number) {
  const lead = remote.trackState === VideoState.Playing && !remote.adPlaying ? SEEK_LEAD_MS / 1000 : 0;
  const wanted = projectProgress(remote, nowMs) + lead;
  const ceiling = Math.max(0, local.durationSeconds - 1);
  return Math.min(Math.max(wanted, 0), ceiling);
}

function remoteIsMusic(remote: Sample): remote is Sample & { videoId: string } {
  return !remote.adPlaying && remote.videoId !== null;
}

export function decide(ctx: SyncContext): SyncResult {
  const { remote, local, nowMs, phase } = ctx;
  const stay = (next: SyncPhase = phase, decisions: Decision[] = []) => ({ decisions, phase: next });

  if (!remote || !local) return stay();

  if (local.adPlaying) return stay();

  const isRemoteStale = !remote.anchored && ctx.lastRemoteUpdateMs !== null && nowMs - ctx.lastRemoteUpdateMs > REMOTE_STALE_MS;

  if (phase === "suspended") {
    const isResumed = ctx.previousLocal !== null && ctx.previousLocal.trackState !== VideoState.Playing && local.trackState === VideoState.Playing;
    if (!isResumed || remote.trackState !== VideoState.Playing || !remoteIsMusic(remote)) return stay();
    if (remote.videoId !== local.videoId) return stay("loading", [{ kind: "navigate", videoId: remote.videoId }]);
    return stay("synced", [{ kind: "seek", seconds: seekTarget(remote, local, nowMs) }]);
  }

  if (!remoteIsMusic(remote)) {
    if (local.trackState === VideoState.Playing) return stay("idle", [{ kind: "pause" }]);
    return stay("idle");
  }

  if (local.videoId !== null && local.videoId !== remote.videoId) {
    const isWeAskedForIt = hasLiveExpectation(ctx, "navigate", local.videoId);
    const wasInSync = ctx.previousLocal !== null && ctx.previousLocal.videoId === remote.videoId;
    if (wasInSync && !isWeAskedForIt) return stay("suspended", [{ kind: "suspend", reason: "You changed the track" }]);
  }

  if (remote.videoId !== local.videoId) {
    if (phase === "loading" && hasLiveExpectation(ctx, "navigate", remote.videoId)) return stay();
    return stay("loading", [{ kind: "navigate", videoId: remote.videoId }]);
  }

  if (phase === "loading") return stay();

  const decisions: Decision[] = [];

  const isRemotePlaying = remote.trackState === VideoState.Playing;
  const isLocalPlaying = local.trackState === VideoState.Playing;
  if (isRemotePlaying !== isLocalPlaying && local.trackState !== VideoState.Buffering) {
    if (!isRemotePlaying) {
      decisions.push({ kind: "pause" });
    } else if (local.trackState === VideoState.Paused) {
      const isWeAskedForIt = hasLiveExpectation(ctx, "pause") || hasLiveExpectation(ctx, "seek");

      if (ctx.previousLocal !== null && ctx.previousLocal.trackState === VideoState.Playing && !isWeAskedForIt) {
        return stay("suspended", [{ kind: "suspend", reason: "You paused playback" }]);
      }
      decisions.push({ kind: "play" });
    }
  }

  if (isRemoteStale) return stay("synced", decisions);
  if (ctx.lastSeekAtMs !== null && nowMs - ctx.lastSeekAtMs < SEEK_SETTLE_MS) return stay("synced", decisions);
  if (local.trackState === VideoState.Buffering) return stay("synced", decisions);
  if (local.durationSeconds > 0 && projectProgress(local, nowMs) > local.durationSeconds - END_GUARD_S) return stay("synced", decisions);

  const drift = projectProgress(remote, nowMs) - projectProgress(local, nowMs);
  if (Math.abs(drift) < DRIFT_DEADBAND_S) return stay("synced", decisions);

  const sinceSeek = ctx.lastSeekAtMs === null ? Number.POSITIVE_INFINITY : nowMs - ctx.lastSeekAtMs;
  const isJump = Math.abs(drift) >= JUMP_THRESHOLD_S;
  const isAllowed = isJump ? sinceSeek >= JUMP_MIN_SEEK_INTERVAL_MS : sinceSeek >= MIN_SEEK_INTERVAL_MS;
  if (!isAllowed) return stay("synced", decisions);

  if (recentSeeks(ctx) + 1 > BREAKER_SEEKS) {
    return stay("suspended", [{ kind: "suspend", reason: "Sync is unstable" }]);
  }

  decisions.push({ kind: "seek", seconds: seekTarget(remote, local, nowMs) });
  return stay("synced", decisions);
}
