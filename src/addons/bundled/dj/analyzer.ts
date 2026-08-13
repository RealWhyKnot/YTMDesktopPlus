// Feeds encoded audio through the hidden dj-analysis window and turns raw
// window results into TrackFeatures. Key estimation and energy mapping happen
// here rather than in the window so they stay unit-testable.

import type { AddonContext } from "../../../main/addons/context";
import type { AddonWindowHandle } from "../../../shared/addons/sdk";
import { estimateKey } from "./key";
import { ANALYSIS_VERSION } from "./feature-db";
import type { TrackFeatures } from "./scoring";

export type WindowResult = {
  videoId: string;
  ok: boolean;
  error?: string;
  bpm?: number | null;
  bpmOffset?: number | null;
  chromaMean?: number[] | null;
  rmsP50?: number;
  rmsP90?: number;
  decodedDurationS?: number;
};

export type TrackMeta = { title: string | null; author: string | null };

export function featuresFromResult(result: WindowResult, meta: TrackMeta = { title: null, author: null }): TrackFeatures | null {
  if (!result.ok) return null;
  const key = result.chromaMean ? estimateKey(result.chromaMean) : null;
  return {
    videoId: result.videoId,
    title: meta.title,
    author: meta.author,
    bpm: typeof result.bpm === "number" && isFinite(result.bpm) ? result.bpm : null,
    bpmConfidence: typeof result.bpm === "number" ? 1 : 0,
    camelot: key ? key.camelot : null,
    keyConfidence: key ? Math.max(0, key.margin) : 0,
    // rms of full-scale audio tops out well under 0.4; 2.5 spreads typical
    // tracks across 0..1 while clamping hot masters.
    energy: typeof result.rmsP90 === "number" ? Math.min(1, result.rmsP90 * 2.5) : null,
    loudnessDb: null,
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
      this.window.send("analyze", job);
    }
  }
}
