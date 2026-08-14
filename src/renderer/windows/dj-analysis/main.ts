// Background track analysis: decode the encoded audio the addon hands over
// and estimate tempo and first-beat offset. Everything DSP-heavy stays in
// this hidden window so decoding never blocks the player.

import { guess } from "web-audio-beat-detector";

type AnalysisJob = { videoId: string; buffer: ArrayBuffer };

type AnalysisBridge = {
  onJob(callback: (job: AnalysisJob) => void): void;
  sendResult(result: unknown): void;
  ready(): void;
};

const bridge = (window as unknown as { ytmdDjAnalysis: AnalysisBridge }).ytmdDjAnalysis;

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
      // No confident tempo; the record still pins the track's duration.
    }

    bridge.sendResult({ videoId: job.videoId, ok: true, bpm, bpmOffset, decodedDurationS: decoded.duration });
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
