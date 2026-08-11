// Decides when the app should mirror a track playing on another device on the
// same account. Input is the account history head (recency-ordered, updated
// within seconds of a track starting anywhere) and the local player state; the
// output is one mirror value or null. Pure: timers, clock, and the history
// fetch are injected, so every path is testable with fake time.
//
// Rules distilled from live measurements (2026-08-11):
// - A new track reaches the history head within one poll of starting on the
//   phone, so the current head IS the remote now-playing signal.
// - Quickly skipped tracks are evicted from history afterwards, so the engine
//   always follows the current head rather than latching the first new id.
// - Local plays land in the same history, so the last few local video ids are
//   held in a ring and never mirrored.
// - History says nothing about stopping; without a newer head the mirror
//   expires after a fixed quiet period.

export type RemoteTrack = {
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string | null;
};

export type Mirror = {
  track: RemoteTrack;
  firstSeenMs: number;
};

export type MirrorEngineDeps = {
  fetchHead(): Promise<RemoteTrack[]>;
  onChange(mirror: Mirror | null): void;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  onPollError?(error: unknown): void;
};

export const POLL_INTERVAL_MS = 25_000;
export const SLOW_POLL_INTERVAL_MS = 90_000;
export const SLOW_AFTER_QUIET_MS = 15 * 60_000;
export const MIRROR_EXPIRY_MS = 6 * 60_000;
export const LOCAL_RING_SIZE = 10;

export class MirrorEngine {
  private deps: MirrorEngineDeps;
  private mirror: Mirror | null = null;
  private localRing: string[] = [];
  private localPlaying = false;
  private timer: unknown = null;
  private polling = false;
  private lastHeadChangeMs = 0;
  private expiredVideoId: string | null = null;
  private stopped = false;

  constructor(deps: MirrorEngineDeps) {
    this.deps = deps;
  }

  start(): void {
    this.lastHeadChangeMs = this.deps.now();
    this.schedule(0);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  /** Local player updates: remember local plays, and silence the mirror the
   *  moment anything plays here. */
  noteLocalState(state: { playing: boolean; videoId: string | null; hasFullMetadata: boolean }): void {
    if (state.videoId && state.hasFullMetadata && this.localRing[this.localRing.length - 1] !== state.videoId) {
      this.localRing.push(state.videoId);
      if (this.localRing.length > LOCAL_RING_SIZE) this.localRing.shift();
    }
    const wasPlaying = this.localPlaying;
    this.localPlaying = state.playing;
    if (state.playing && this.mirror) this.setMirror(null);
    if (wasPlaying && !state.playing && !this.stopped) {
      // Freshly idle: look right away instead of waiting out a full interval.
      this.schedule(0);
    }
  }

  current(): Mirror | null {
    return this.mirror;
  }

  private setMirror(mirror: Mirror | null): void {
    this.mirror = mirror;
    this.deps.onChange(mirror);
  }

  private schedule(ms: number): void {
    if (this.stopped) return;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.poll();
    }, ms);
  }

  private async poll(): Promise<void> {
    if (this.stopped) return;
    if (this.localPlaying) {
      // Nothing to do while the desktop itself plays; local state changes
      // reschedule polling when playback stops.
      return;
    }
    if (!this.polling) {
      this.polling = true;
      try {
        const head = (await this.deps.fetchHead())[0];
        const now = this.deps.now();
        if (head?.videoId) {
          if (this.localRing.includes(head.videoId)) {
            if (this.mirror) this.setMirror(null);
          } else if (head.videoId === this.expiredVideoId) {
            // An expired session stays cleared until something new plays;
            // re-mirroring the same stale head would flap forever.
          } else if (this.mirror?.track.videoId !== head.videoId) {
            this.expiredVideoId = null;
            this.lastHeadChangeMs = now;
            this.setMirror({ track: head, firstSeenMs: now });
          } else if (now - this.lastHeadChangeMs > MIRROR_EXPIRY_MS) {
            // The same head for this long means the listening session most
            // likely ended; history cannot say so directly.
            this.expiredVideoId = head.videoId;
            this.setMirror(null);
          }
        }
      } catch (error) {
        this.deps.onPollError?.(error);
      } finally {
        this.polling = false;
      }
    }
    const quiet = this.deps.now() - this.lastHeadChangeMs > SLOW_AFTER_QUIET_MS;
    this.schedule(quiet ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
  }
}
