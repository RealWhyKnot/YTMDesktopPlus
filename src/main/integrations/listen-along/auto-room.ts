import type { RoomPhase } from "~shared/room-protocol";

// Keeps a room open automatically while Discord presence is shared, so the
// Join Room button and its web player link exist without the user starting
// anything. The room is anonymous unless a display name was saved.
//
// A manual "leave" while hosting means the user does not want a room right
// now, so automation stands down until one of the governing toggles cycles or
// the app restarts.

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
  private suppressed = false;
  private startedCurrent = false;
  private regrowTimer: NodeJS.Timeout | null = null;
  private regrowAttempts = 0;

  constructor(private readonly deps: AutoRoomDeps) {}

  /** Idempotent; safe to call on any state change. */
  evaluate() {
    if (this.suppressed) return;
    if (!this.deps.enabled()) return;
    const phase = this.deps.phase();
    if (phase === "hosting") {
      this.regrowAttempts = 0;
      return;
    }
    if (phase === "failed" && this.deps.isHost()) {
      this.scheduleRegrow();
      return;
    }
    if (phase !== "idle") return;
    this.cancelRegrow();
    this.startedCurrent = true;
    this.deps.host(this.deps.savedDisplayName());
  }

  /** The user started or joined a room themselves; it is theirs to manage. */
  noteManualSession() {
    this.startedCurrent = false;
  }

  noteManualLeave(wasHost: boolean) {
    this.startedCurrent = false;
    if (wasHost) {
      this.suppressed = true;
      this.cancelRegrow();
    }
  }

  /**
   * A governing toggle changed. Turning the feature off closes a room this
   * class opened; turning it on is the user steering again, so any earlier
   * stand-down is forgotten.
   */
  syncToggles() {
    this.suppressed = false;
    if (!this.deps.enabled()) {
      this.cancelRegrow();
      if (this.startedCurrent) {
        this.startedCurrent = false;
        this.deps.leave();
      }
      return;
    }
    this.evaluate();
  }

  dispose() {
    this.suppressed = true;
    this.cancelRegrow();
  }

  private scheduleRegrow() {
    if (this.regrowTimer) return;
    const delay = REGROW_DELAYS_MS[Math.min(this.regrowAttempts, REGROW_DELAYS_MS.length - 1)];
    this.regrowAttempts++;
    this.deps.log(`Room failed, opening a new one in ${delay / 1000}s`);
    this.regrowTimer = setTimeout(() => {
      this.regrowTimer = null;
      if (this.suppressed || !this.deps.enabled()) return;
      if (this.deps.phase() !== "failed" || !this.deps.isHost()) return;
      this.startedCurrent = true;
      this.deps.host(this.deps.savedDisplayName());
    }, delay);
  }

  private cancelRegrow() {
    if (this.regrowTimer) clearTimeout(this.regrowTimer);
    this.regrowTimer = null;
  }
}
