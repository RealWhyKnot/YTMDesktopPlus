export type RemoteTrack = {
  videoId: string;
  title: string;
  author: string;
  thumbnailUrl: string | null;

  durationSeconds?: number | null;
};

export type Mirror = {
  track: RemoteTrack;
  firstSeenMs: number;
};

export type MirrorEngineDeps<TTimer> = {
  fetchHead(): Promise<RemoteTrack[]>;

  fetchDuration?(videoId: string): Promise<number | null>;
  onChange(mirror: Mirror | null): void;
  now(): number;
  setTimer(fn: () => void, ms: number): TTimer;
  clearTimer(handle: TTimer): void;
  onPollError?(error: unknown): void;
};

export const POLL_INTERVAL_MS = 25_000;
export const SLOW_POLL_INTERVAL_MS = 90_000;
export const SLOW_AFTER_QUIET_MS = 15 * 60_000;
export const MIRROR_EXPIRY_MS = 6 * 60_000;
export const EXPIRY_SLACK_MS = 60_000;
export const DURATION_CACHE_SIZE = 8;
export const LOCAL_RING_SIZE = 10;

export class MirrorEngine<TTimer> {
  private deps: MirrorEngineDeps<TTimer>;
  private mirror: Mirror | null = null;
  private localRing: string[] = [];
  private isLocalPlaying = false;
  private timer: TTimer | null = null;
  private isPolling = false;
  private lastHeadChangeMs = 0;
  private expiredVideoId: string | null = null;
  private currentExpiryMs = MIRROR_EXPIRY_MS;
  private durations = new Map<string, number>();
  private isStopped = false;

  constructor(deps: MirrorEngineDeps<TTimer>) {
    this.deps = deps;
  }

  start(): void {
    this.lastHeadChangeMs = this.deps.now();
    this.schedule(0);
  }

  stop(): void {
    this.isStopped = true;
    if (this.timer !== null) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
  }

  noteLocalState(state: { playing: boolean; videoId: string | null; hasFullMetadata: boolean }): void {
    if (state.videoId && state.hasFullMetadata && this.localRing[this.localRing.length - 1] !== state.videoId) {
      this.localRing.push(state.videoId);
      if (this.localRing.length > LOCAL_RING_SIZE) this.localRing.shift();
    }
    const wasPlaying = this.isLocalPlaying;
    this.isLocalPlaying = state.playing;
    if (state.playing && this.mirror) this.setMirror(null);
    if (wasPlaying && !state.playing && !this.isStopped) {
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
      const oldest = this.durations.keys().next().value;
      if (oldest !== undefined) this.durations.delete(oldest);
    }
  }

  private applyExpiry(track: RemoteTrack): void {
    const hasDuration = Boolean(track.durationSeconds);
    const known = hasDuration ? track.durationSeconds : this.durations.get(track.videoId);
    if (known) {
      this.rememberDuration(track.videoId, known);
      this.currentExpiryMs = known * 1000 + EXPIRY_SLACK_MS;
      return;
    }
    this.currentExpiryMs = MIRROR_EXPIRY_MS;

    if (!this.deps.fetchDuration || this.durations.has(track.videoId)) return;
    this.rememberDuration(track.videoId, 0);
    void this.deps
      .fetchDuration(track.videoId)
      .then((seconds) => {
        if (!seconds) return;
        this.rememberDuration(track.videoId, seconds);
        if (this.mirror?.track.videoId === track.videoId) {
          this.currentExpiryMs = seconds * 1000 + EXPIRY_SLACK_MS;
        }
      })
      .catch((error: unknown) => this.deps.onPollError?.(error));
  }

  private schedule(ms: number): void {
    if (this.isStopped) return;
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.poll().catch((error: unknown) => console.warn("schedule failed", error));
    }, ms);
  }

  private async poll(): Promise<void> {
    if (this.isStopped) return;
    if (this.isLocalPlaying) {
      return;
    }
    if (!this.isPolling) {
      this.isPolling = true;
      try {
        const head = (await this.deps.fetchHead())[0];
        const now = this.deps.now();
        if (head?.videoId) {
          if (this.localRing.includes(head.videoId)) {
            if (this.mirror) this.setMirror(null);
          } else if (head.videoId !== this.expiredVideoId && this.mirror?.track.videoId !== head.videoId) {
            this.expiredVideoId = null;
            this.lastHeadChangeMs = now;
            this.applyExpiry(head);
            this.setMirror({ track: head, firstSeenMs: now });
          } else if (head.videoId !== this.expiredVideoId && now - this.lastHeadChangeMs > this.currentExpiryMs) {
            this.expiredVideoId = head.videoId;
            this.setMirror(null);
          }
        }
      } catch (error) {
        this.deps.onPollError?.(error);
      } finally {
        this.isPolling = false;
      }
    }
    const isQuiet = this.deps.now() - this.lastHeadChangeMs > SLOW_AFTER_QUIET_MS;
    this.schedule(isQuiet ? SLOW_POLL_INTERVAL_MS : POLL_INTERVAL_MS);
  }
}
