import type { PlayerState } from "../../player-state-store";
import type { CueResult } from "../../playback/cue-track";
import { BREAKER_WINDOW_MS, decide } from "./sync-engine";
import type { Decision, Expectation, Sample, SyncPhase } from "./types";

// The follower half of Listen Along, shared by the LAN follow and relay rooms:
// takes local player state and remote samples, runs the sync engine, and turns
// its decisions into playback commands. Everything side-effecting is injected
// so this stays testable and free of Electron.

// How long a command we issued stays attributable to us before a matching local
// change counts as the user reaching for the controls.
export const EXPECTATION_TTL_MS = 1500;
// Local state fires on every player mutation, including queue changes carrying
// the full queue, so the decision loop runs on a floor rather than per message.
export const DECISION_INTERVAL_MS = 200;

export type FollowerPhaseEvent = { phase: "loading" } | { phase: "synced" } | { phase: "suspended"; reason: string };

export interface FollowerDeps {
  cueTrack(request: { videoId: string; anchor: { kind: "anchor"; epochMs: number } | null }): Promise<CueResult>;
  sendCommand(command: "seekTo" | "play" | "pause", value?: number): void;
  onPhase(event: FollowerPhaseEvent): void;
  now(): number;
}

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

  constructor(private readonly deps: FollowerDeps) {}

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
      asOfMs: this.deps.now()
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

  // Rejoining after the user took over is a deliberate action, so it clears the
  // breaker as well as the phase.
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
    this.clearRemote();
    this.local = null;
    this.previousLocal = null;
    this.expectations = [];
    this.seekTimestamps = [];
    this.lastSeekAtMs = null;
  }

  private expect(kind: Expectation["kind"], target?: string | number) {
    const now = this.deps.now();
    this.expectations = this.expectations.filter(expectation => expectation.expiresAtMs > now);
    this.expectations.push({ kind, target, expiresAtMs: now + EXPECTATION_TTL_MS });
  }

  private apply(decision: Decision) {
    switch (decision.kind) {
      case "navigate": {
        this.expect("navigate", decision.videoId);
        this.deps.onPhase({ phase: "loading" });
        // The track cue owns the navigate and the seek that follows it, and
        // supersedes itself when the host skips again.
        void this.deps
          .cueTrack({
            videoId: decision.videoId,
            anchor: this.remote ? { kind: "anchor", epochMs: this.remote.asOfMs - this.remote.progress * 1000 } : null
          })
          .then(result => {
            if (this.phase === "loading") {
              this.phase = result === "no-view" ? "idle" : "synced";
              if (this.phase === "synced") this.deps.onPhase({ phase: "synced" });
            }
          });
        break;
      }
      case "seek": {
        const now = this.deps.now();
        this.expect("seek", decision.seconds);
        this.lastSeekAtMs = now;
        this.seekTimestamps = [...this.seekTimestamps.filter(at => now - at < BREAKER_WINDOW_MS), now];
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

  private runDecision(force = false) {
    const now = this.deps.now();
    if (!force && now - this.lastDecisionAtMs < DECISION_INTERVAL_MS) return;
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
      expectations: this.expectations
    });

    const previousPhase = this.phase;
    this.phase = result.phase;
    for (const decision of result.decisions) this.apply(decision);

    if (previousPhase !== "synced" && previousPhase !== "loading" && this.phase === "synced") {
      this.deps.onPhase({ phase: "synced" });
    }
  }
}
