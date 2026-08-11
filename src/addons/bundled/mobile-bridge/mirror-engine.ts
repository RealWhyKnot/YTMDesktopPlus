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
  /** From the history row when it carries one; null means unknown */
  durationSeconds?: number | null;
};

export type Mirror = {
  track: RemoteTrack;
  firstSeenMs: number;
};

export type MirrorEngineDeps = {
  fetchHead(): Promise<RemoteTrack[]>;
  /** One-shot duration lookup for tracks whose history row carries none.
   *  Called at most once per videoId; answers are cached. Optional: without
   *  it, unknown durations fall back to the flat expiry. */
  fetchDuration?(videoId: string): Promise<number | null>;
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
export const EXPIRY_SLACK_MS = 60_000;
export const DURATION_CACHE_SIZE = 8;
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
  private currentExpiryMs = MIRROR_EXPIRY_MS;
  private durations = new Map<string, number>();
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

  private rememberDuration(videoId: string, seconds: number): void {
    this.durations.set(videoId, seconds);
    if (this.durations.size > DURATION_CACHE_SIZE) {
      this.durations.delete(this.durations.keys().next().value);
    }
  }

  /** Sets the expiry window for a newly mirrored track: its duration plus
   *  slack when known (history row, then cache, then one lookup), the flat
   *  fallback otherwise. The lookup happens at most once per videoId. */
  private applyExpiry(track: RemoteTrack): void {
    const known = track.durationSeconds || this.durations.get(track.videoId);
    if (known) {
      this.rememberDuration(track.videoId, known);
      this.currentExpiryMs = known * 1000 + EXPIRY_SLACK_MS;
      return;
    }
    this.currentExpiryMs = MIRROR_EXPIRY_MS;
    // A cache entry, even the 0 recorded on a miss, means this id was already
    // looked up once; never ask again.
    if (!this.deps.fetchDuration || this.durations.has(track.videoId)) return;
    this.rememberDuration(track.videoId, 0);
    void this.deps
      .fetchDuration(track.videoId)
      .then(seconds => {
        if (!seconds) return;
        this.rememberDuration(track.videoId, seconds);
        if (this.mirror?.track.videoId === track.videoId) {
          this.currentExpiryMs = seconds * 1000 + EXPIRY_SLACK_MS;
        }
      })
      .catch(error => this.deps.onPollError?.(error));
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
            this.applyExpiry(head);
            this.setMirror({ track: head, firstSeenMs: now });
          } else if (now - this.lastHeadChangeMs > this.currentExpiryMs) {
            // No newer track for the length of this one plus slack means the
            // listening session most likely ended; history cannot say so
            // directly (pause and stop are invisible to it).
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
