import { VideoState } from "../../player-state-store";

export type Sample = {
  videoId: string | null;
  durationSeconds: number;
  progress: number;
  trackState: VideoState;
  adPlaying: boolean;

  asOfMs: number;
  anchored?: boolean;
};

export type SyncPhase = "idle" | "loading" | "synced" | "suspended";

export type Decision =
  { kind: "navigate"; videoId: string } | { kind: "seek"; seconds: number } | { kind: "play" } | { kind: "pause" } | { kind: "suspend"; reason: string };

export type Expectation = {
  kind: "navigate" | "seek" | "play" | "pause";
  target?: string | number;
  expiresAtMs: number;
};

export type SyncContext = {
  remote: Sample | null;
  local: Sample | null;

  previousLocal: Sample | null;
  nowMs: number;
  phase: SyncPhase;
  lastSeekAtMs: number | null;
  lastRemoteUpdateMs: number | null;
  seekTimestamps: number[];
  expectations: Expectation[];
};
