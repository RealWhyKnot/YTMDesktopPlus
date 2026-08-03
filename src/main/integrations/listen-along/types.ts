import { VideoState } from "../../player-state-store";

export type Sample = {
  videoId: string | null;
  durationSeconds: number;
  progress: number;
  trackState: VideoState;
  adPlaying: boolean;
  // Wall clock the sample describes. Remote samples are stamped back by the
  // measured one way latency so both sides can be projected onto the same
  // timeline.
  asOfMs: number;
};

export type SyncPhase = "idle" | "loading" | "synced" | "suspended";

export type Decision =
  | { kind: "navigate"; videoId: string }
  | { kind: "seek"; seconds: number }
  | { kind: "play" }
  | { kind: "pause" }
  | { kind: "suspend"; reason: string };

// A command we issued and are still expecting to see reflected locally. Used to
// tell our own effects apart from the user reaching for the controls.
export type Expectation = {
  kind: "navigate" | "seek" | "play" | "pause";
  target?: string | number;
  expiresAtMs: number;
};

export type SyncContext = {
  remote: Sample | null;
  local: Sample | null;
  // The local sample before this one, used to tell whether a change came from
  // the host moving or from the user reaching for the controls.
  previousLocal: Sample | null;
  nowMs: number;
  phase: SyncPhase;
  lastSeekAtMs: number | null;
  lastRemoteUpdateMs: number | null;
  seekTimestamps: number[];
  expectations: Expectation[];
};
