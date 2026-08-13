// Per-track feature store: one JSON file in the addon's data directory.
// Atomic tmp+rename writes, debounced flush, corrupt files start over, and an
// analysisVersion bump invalidates every stored record at load time.

import { promises as fs } from "fs";
import path from "path";
import type { TrackFeatures } from "./scoring";

export const ANALYSIS_VERSION = 2;

type DbShape = {
  analysisVersion: number;
  tracks: Record<string, TrackFeatures>;
};

export class FeatureDb {
  private tracks = new Map<string, TrackFeatures>();
  private loaded = false;
  private flushTimer: NodeJS.Timeout | null = null;
  private writing = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly flushDelayMs = 2000
  ) {}

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as DbShape;
      if (parsed.analysisVersion === ANALYSIS_VERSION && parsed.tracks && typeof parsed.tracks === "object") {
        for (const [videoId, features] of Object.entries(parsed.tracks)) {
          if (features && typeof features === "object") this.tracks.set(videoId, features);
        }
      }
    } catch {
      // Missing or corrupt file; start empty.
    }
  }

  get(videoId: string): TrackFeatures | null {
    return this.tracks.get(videoId) ?? null;
  }

  has(videoId: string): boolean {
    return this.tracks.has(videoId);
  }

  size(): number {
    return this.tracks.size;
  }

  all(): TrackFeatures[] {
    return Array.from(this.tracks.values());
  }

  set(features: TrackFeatures): void {
    this.tracks.set(features.videoId, features);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushDelayMs);
    // Never keep the process alive just for a pending flush.
    this.flushTimer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const payload: DbShape = { analysisVersion: ANALYSIS_VERSION, tracks: Object.fromEntries(this.tracks) };
    this.writing = this.writing.then(async () => {
      const tmpPath = `${this.filePath}.tmp`;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(tmpPath, JSON.stringify(payload), "utf8");
      await fs.rename(tmpPath, this.filePath);
    });
    await this.writing;
  }
}
