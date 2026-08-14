// Feeds encoded audio through the hidden dj-analysis window and turns raw
// window results into TrackFeatures.

import type { AddonContext } from "../../../main/addons/context";
import type { AddonWindowHandle } from "../../../shared/addons/sdk";
import { ANALYSIS_VERSION, type TrackFeatures } from "./feature-db";

export type WindowResult = {
  videoId: string;
  ok: boolean;
  error?: string;
  bpm?: number | null;
  bpmOffset?: number | null;
  decodedDurationS?: number;
};

export type TrackMeta = { title: string | null; author: string | null };

const JOB_TIMEOUT_MS = 120000;

export function featuresFromResult(result: WindowResult, meta: TrackMeta = { title: null, author: null }): TrackFeatures | null {
  if (!result.ok) return null;
  return {
    videoId: result.videoId,
    title: meta.title,
    author: meta.author,
    bpm: typeof result.bpm === "number" && isFinite(result.bpm) ? result.bpm : null,
    durationS: result.decodedDurationS ?? 0,
    beatOffsetS: typeof result.bpmOffset === "number" && isFinite(result.bpmOffset) ? result.bpmOffset : null,
    analysisVersion: ANALYSIS_VERSION,
    analyzedAt: Date.now()
  };
}

export class Analyzer {
  private window: AddonWindowHandle | null = null;
  private windowReady = false;
  private pending: { videoId: string; buffer: ArrayBuffer }[] = [];
  private inFlight = new Set<string>();
  private meta = new Map<string, TrackMeta>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly ctx: AddonContext,
    private readonly onFeatures: (features: TrackFeatures) => void
  ) {
    ctx.ipc.on("analysisReady", () => {
      this.windowReady = true;
      this.drain();
    });
    ctx.ipc.on("analysisResult", (_event, raw: unknown) => {
      const result = raw as WindowResult;
      if (!result || typeof result.videoId !== "string") return;
      this.inFlight.delete(result.videoId);
      this.clearTimer(result.videoId);
      const meta = this.meta.get(result.videoId) ?? { title: null, author: null };
      this.meta.delete(result.videoId);
      if (!result.ok) {
        ctx.log.info(`Analysis failed for ${result.videoId}: ${result.error}`);
        return;
      }
      const features = featuresFromResult(result, meta);
      if (features) this.onFeatures(features);
    });
  }

  isBusy(videoId: string): boolean {
    return this.inFlight.has(videoId) || this.pending.some(job => job.videoId === videoId);
  }

  submit(videoId: string, buffer: ArrayBuffer, meta?: TrackMeta): void {
    if (this.isBusy(videoId)) return;
    if (meta) this.meta.set(videoId, meta);
    this.pending.push({ videoId, buffer });
    this.ensureWindow();
    this.drain();
  }

  close(): void {
    this.window?.close();
    this.window = null;
    this.windowReady = false;
    this.pending = [];
    this.inFlight.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private clearTimer(videoId: string): void {
    const timer = this.timers.get(videoId);
    if (!timer) return;
    clearTimeout(timer);
    this.timers.delete(videoId);
  }

  private ensureWindow(): void {
    if (this.window?.isOpen()) return;
    this.windowReady = false;
    this.window = this.ctx.windows.create({ entry: "dj-analysis", width: 320, height: 180, show: false, title: "Track analysis" });
  }

  private drain(): void {
    if (!this.windowReady || !this.window?.isOpen()) return;
    for (const job of this.pending.splice(0)) {
      this.inFlight.add(job.videoId);
      // Without this a crashed or wedged window would leave the id in flight
      // forever, and isBusy would then skip every later track of the session.
      const timer = setTimeout(() => {
        this.timers.delete(job.videoId);
        if (!this.inFlight.delete(job.videoId)) return;
        this.meta.delete(job.videoId);
        this.ctx.log.info(`Analysis timed out for ${job.videoId}`);
      }, JOB_TIMEOUT_MS);
      timer.unref();
      this.timers.set(job.videoId, timer);
      this.window.send("analyze", job);
    }
  }
}
