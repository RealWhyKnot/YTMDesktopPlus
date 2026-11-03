import type { PlayerState } from "../../player-state-store";
import type { CueResult } from "~shared/addons/sdk";
import { BREAKER_WINDOW_MS, decide } from "./sync-engine";
import type { Decision, Expectation, Sample, SyncPhase } from "./types";

export const EXPECTATION_TTL_MS = 1500;

export const DECISION_INTERVAL_MS = 200;

export type FollowerPhaseEvent = { phase: "loading" } | { phase: "synced" } | { phase: "suspended"; reason: string };

export type FollowerDeps = {
  cueTrack(request: { videoId: string; anchor: { kind: "anchor"; epochMs: number } | null }): Promise<CueResult>;
  sendCommand(command: "seekTo" | "play" | "pause", value?: number): void;
  onPhase(event: FollowerPhaseEvent): void;
  now(): number;
  cancelCue?(): void;
};

export class FollowerEngine {
  private remote: Sample | null = null;
  private local: Sample | null = null;
  private previousLocal: Sample | null = null;
  private phase: SyncPhase = "idle";
  private lastSeekAtMs: number | null = null;
  private lastRemoteUpdateMs: number | null = null;
  private seekTimestamps: number[] = [];
  private expectations: Expectation[] = [];
  private lastDecisionAtMs = 0;
  private pendingDecision: NodeJS.Timeout | null = null;
  private cueGeneration = 0;
  private isCuePending = false;

  private readonly deps: FollowerDeps;
  constructor(deps: FollowerDeps) {
    this.deps = deps;
  }

  get currentPhase(): SyncPhase {
    return this.phase;
  }

  updateLocal(state: PlayerState) {
    this.previousLocal = this.local;
    this.local = {
      videoId: state.videoDetails?.id ?? null,
      durationSeconds: state.videoDetails?.durationSeconds ?? 0,
      progress: state.videoProgress,
      trackState: state.trackState,
      adPlaying: state.adPlaying,
      asOfMs: this.deps.now(),
    };
    this.runDecision();
  }

  updateRemote(sample: Sample) {
    this.lastRemoteUpdateMs = this.deps.now();
    this.remote = sample;
    this.runDecision();
  }

  clearRemote() {
    this.remote = null;
    this.lastRemoteUpdateMs = null;
    this.phase = "idle";
  }

  resume() {
    if (this.phase !== "suspended") return;
    this.seekTimestamps = [];
    this.lastSeekAtMs = null;
    this.phase = "synced";
    this.deps.onPhase({ phase: "synced" });
    this.runDecision(true);
  }

  kick() {
    this.runDecision(true);
  }

  reset() {
    this.cueGeneration++;
    if (this.isCuePending) {
      this.isCuePending = false;
      this.deps.cancelCue?.();
    }
    this.clearRemote();
    if (this.pendingDecision) clearTimeout(this.pendingDecision);
    this.pendingDecision = null;
    this.local = null;
    this.previousLocal = null;
    this.expectations = [];
    this.seekTimestamps = [];
    this.lastSeekAtMs = null;
  }

  private expect(kind: Expectation["kind"], target?: string | number) {
    const now = this.deps.now();
    this.expectations = this.expectations.filter((expectation) => expectation.expiresAtMs > now);
    this.expectations.push({ kind, target, expiresAtMs: now + EXPECTATION_TTL_MS });
  }

  private apply(decision: Decision) {
    switch (decision.kind) {
      case "navigate": {
        this.expect("navigate", decision.videoId);
        this.deps.onPhase({ phase: "loading" });

        const generation = ++this.cueGeneration;
        this.isCuePending = true;
        void this.deps
          .cueTrack({
            videoId: decision.videoId,
            anchor: this.remote ? { kind: "anchor", epochMs: this.remote.asOfMs - this.remote.progress * 1000 } : null,
          })
          .then((result) => {
            if (generation !== this.cueGeneration) return;
            this.isCuePending = false;
            if (this.phase === "loading") {
              this.phase = result === "no-view" ? "idle" : "synced";
              if (this.phase === "synced") this.deps.onPhase({ phase: "synced" });
            }
          })
          .catch((error: unknown) => console.warn("apply failed", error));
        break;
      }
      case "seek": {
        const now = this.deps.now();
        this.expect("seek", decision.seconds);
        this.lastSeekAtMs = now;
        this.seekTimestamps = [...this.seekTimestamps.filter((at) => now - at < BREAKER_WINDOW_MS), now];
        this.deps.sendCommand("seekTo", decision.seconds);
        break;
      }
      case "play": {
        this.expect("play");
        this.deps.sendCommand("play");
        break;
      }
      case "pause": {
        this.expect("pause");
        this.deps.sendCommand("pause");
        break;
      }
      case "suspend": {
        this.deps.onPhase({ phase: "suspended", reason: decision.reason });
        break;
      }
    }
  }

  private runDecision(isForce = false) {
    const now = this.deps.now();
    if (!isForce && now - this.lastDecisionAtMs < DECISION_INTERVAL_MS) {
      this.pendingDecision ??= setTimeout(
        () => {
          this.pendingDecision = null;
          this.runDecision(true);
        },
        DECISION_INTERVAL_MS - (now - this.lastDecisionAtMs) + 1
      );
      return;
    }
    this.lastDecisionAtMs = now;

    const result = decide({
      remote: this.remote,
      local: this.local,
      previousLocal: this.previousLocal,
      nowMs: now,
      phase: this.phase,
      lastSeekAtMs: this.lastSeekAtMs,
      lastRemoteUpdateMs: this.lastRemoteUpdateMs,
      seekTimestamps: this.seekTimestamps,
      expectations: this.expectations,
    });

    const previousPhase = this.phase;
    this.phase = result.phase;
    for (const decision of result.decisions) this.apply(decision);

    if (previousPhase !== "synced" && previousPhase !== "loading" && this.phase === "synced") {
      this.deps.onPhase({ phase: "synced" });
    }
  }
}
