import type { RoomPhase } from "~shared/room-protocol";

// Keeps a room open automatically while Discord presence is shared, so the
// Join Room button and its web player link exist without the user starting
// anything. The room is anonymous unless a display name was saved.
//
// A manual "leave" while hosting means the user does not want a room right
// now, so automation stands down until one of the governing toggles cycles or
// the app restarts. A failed session (relay unreachable after all retries)
// also stands down rather than hammering a dead service.

export type AutoRoomDeps = {
  enabled(): boolean;
  phase(): RoomPhase;
  savedDisplayName(): string | null;
  host(displayName: string | null): void;
  leave(): void;
};

export class AutoRoom {
  private suppressed = false;
  private startedCurrent = false;

  constructor(private readonly deps: AutoRoomDeps) {}

  /** Idempotent; safe to call on any state change. */
  evaluate() {
    if (this.suppressed) return;
    if (!this.deps.enabled()) return;
    if (this.deps.phase() !== "idle") return;
    this.startedCurrent = true;
    this.deps.host(this.deps.savedDisplayName());
  }

  /** The user started or joined a room themselves; it is theirs to manage. */
  noteManualSession() {
    this.startedCurrent = false;
  }

  noteManualLeave(wasHost: boolean) {
    this.startedCurrent = false;
    if (wasHost) this.suppressed = true;
  }

  /**
   * A governing toggle changed. Turning the feature off closes a room this
   * class opened; turning it on is the user steering again, so any earlier
   * stand-down is forgotten.
   */
  syncToggles() {
    this.suppressed = false;
    if (!this.deps.enabled()) {
      if (this.startedCurrent) {
        this.startedCurrent = false;
        this.deps.leave();
      }
      return;
    }
    this.evaluate();
  }
}
