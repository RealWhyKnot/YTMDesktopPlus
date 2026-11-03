import type { RoomPhase } from "~shared/room-protocol";

export const REGROW_DELAYS_MS = [5_000, 30_000, 120_000, 300_000];

export type AutoRoomDeps = {
  enabled(): boolean;
  phase(): RoomPhase;
  isHost(): boolean;
  savedDisplayName(): string | null;
  host(displayName: string | null): void;
  leave(): void;
  log(message: string): void;
};

export class AutoRoom {
  private isSuppressed = false;
  private isStartedCurrent = false;
  private regrowTimer: NodeJS.Timeout | null = null;
  private regrowAttempts = 0;

  private readonly deps: AutoRoomDeps;
  constructor(deps: AutoRoomDeps) {
    this.deps = deps;
  }

  evaluate() {
    if (this.isSuppressed) return;
    if (!this.deps.enabled()) return;
    const phase = this.deps.phase();
    if (phase === "hosting") {
      this.regrowAttempts = 0;
      this.cancelRegrow();
      return;
    }
    if (phase === "failed" && this.deps.isHost()) {
      this.scheduleRegrow();
      return;
    }
    if (phase !== "idle") return;
    this.cancelRegrow();
    this.isStartedCurrent = true;
    this.deps.host(this.deps.savedDisplayName());
  }

  noteManualSession() {
    this.isStartedCurrent = false;
  }

  noteManualLeave(wasHost: boolean) {
    this.isStartedCurrent = false;
    if (wasHost) {
      this.isSuppressed = true;
      this.cancelRegrow();
    }
  }

  syncToggles() {
    this.isSuppressed = false;
    if (!this.deps.enabled()) {
      this.cancelRegrow();
      if (this.isStartedCurrent) {
        this.isStartedCurrent = false;
        this.deps.leave();
      }
      return;
    }
    this.evaluate();
  }

  dispose() {
    this.isSuppressed = true;
    this.cancelRegrow();
  }

  private scheduleRegrow() {
    if (this.regrowTimer) return;
    const delay = REGROW_DELAYS_MS[Math.min(this.regrowAttempts, REGROW_DELAYS_MS.length - 1)];
    if (delay === undefined) throw new Error("Room retry delay is unavailable");
    this.regrowAttempts++;
    this.deps.log(`Room failed, opening a new one in ${delay / 1000}s`);
    this.regrowTimer = setTimeout(() => {
      this.regrowTimer = null;
      if (this.isSuppressed || !this.deps.enabled()) return;
      if (this.deps.phase() !== "failed" || !this.deps.isHost()) return;
      this.isStartedCurrent = true;
      this.deps.host(this.deps.savedDisplayName());
    }, delay);
  }

  private cancelRegrow() {
    if (this.regrowTimer) clearTimeout(this.regrowTimer);
    this.regrowTimer = null;
  }
}
