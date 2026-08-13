// Background track analysis: decode the encoded audio the addon hands over,
// estimate tempo and first-beat offset, average a chromagram and summarize
// energy. Everything DSP-heavy stays in this hidden window; the key call and
// scoring happen in the main process where they are unit-testable.

import { guess } from "web-audio-beat-detector";
import Meyda from "meyda";

type AnalysisJob = { videoId: string; buffer: ArrayBuffer };

type AnalysisBridge = {
  onJob(callback: (job: AnalysisJob) => void): void;
  sendResult(result: unknown): void;
  ready(): void;
};

const bridge = (window as unknown as { ytmdDjAnalysis: AnalysisBridge }).ytmdDjAnalysis;

const FRAME_SIZE = 4096;

function mixdown(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) mono[i] += data[i];
  }
  if (buffer.numberOfChannels > 1) {
    for (let i = 0; i < mono.length; i++) mono[i] /= buffer.numberOfChannels;
  }
  return mono;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

async function analyze(job: AnalysisJob) {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(job.buffer);

    let bpm: number | null = null;
    let bpmOffset: number | null = null;
    try {
      const guessed = await guess(decoded, { minTempo: 60, maxTempo: 200 });
      bpm = guessed.bpm;
      bpmOffset = guessed.offset;
    } catch {
      // No confident tempo; the record still carries key and energy.
    }

    const mono = mixdown(decoded);
    Meyda.sampleRate = decoded.sampleRate;
    Meyda.bufferSize = FRAME_SIZE;
    const chromaSum = new Array<number>(12).fill(0);
    const rmsValues: number[] = [];
    let frames = 0;
    for (let start = 0; start + FRAME_SIZE <= mono.length; start += FRAME_SIZE) {
      const frame = mono.subarray(start, start + FRAME_SIZE);
      const extracted = Meyda.extract(["chroma", "rms"], frame) as { chroma?: number[]; rms?: number };
      if (extracted?.chroma?.length === 12) {
        for (let i = 0; i < 12; i++) chromaSum[i] += extracted.chroma[i];
      }
      if (typeof extracted?.rms === "number") rmsValues.push(extracted.rms);
      frames++;
    }
    rmsValues.sort((a, b) => a - b);

    bridge.sendResult({
      videoId: job.videoId,
      ok: true,
      bpm,
      bpmOffset,
      chromaMean: frames > 0 ? chromaSum.map(v => v / frames) : null,
      rmsP50: percentile(rmsValues, 0.5),
      rmsP90: percentile(rmsValues, 0.9),
      decodedDurationS: decoded.duration
    });
  } catch (error) {
    bridge.sendResult({ videoId: job.videoId, ok: false, error: String(error) });
  } finally {
    await context.close();
  }
}

let busy = Promise.resolve();
bridge.onJob(job => {
  busy = busy.then(() => analyze(job));
});
bridge.ready();
