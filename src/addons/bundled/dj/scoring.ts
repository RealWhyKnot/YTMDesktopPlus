// Mix compatibility between two analyzed tracks, 0..1. Tempo dominates, key
// second, energy continuity third; unanalyzed candidates score neutral so the
// radio keeps working while the library fills in.

import { camelotAffinity } from "./key";

export type TrackFeatures = {
  videoId: string;
  title: string | null;
  author: string | null;
  bpm: number | null;
  bpmConfidence: number;
  camelot: string | null;
  keyConfidence: number;
  // 0..1 normalized RMS summary
  energy: number | null;
  loudnessDb: number | null;
  durationS: number;
  // First-beat offset in seconds; the beat grid is offset + n * 60/bpm
  beatOffsetS: number | null;
  analysisVersion: number;
  analyzedAt: number;
};

export type ScoreContext = {
  // videoIds played recently, most recent first
  recentVideoIds?: string[];
  // author of the currently playing track, for artist-repeat penalty
  currentAuthor?: string;
  candidateAuthor?: string;
};

const NEUTRAL = 0.5;

export function tempoAffinity(bpmA: number, bpmB: number): number {
  let best = Infinity;
  for (const multiplier of [0.5, 1, 2]) {
    const distance = Math.abs(Math.log2((bpmB * multiplier) / bpmA));
    if (distance < best) best = distance;
  }
  return Math.exp(-((best / 0.06) ** 2));
}

export function energyAffinity(energyA: number, energyB: number): number {
  const closeness = 1 - Math.min(1, Math.abs(energyA - energyB) * 2);
  // Mild preference for building energy over dropping it.
  const ramp = energyB >= energyA ? 0.1 : 0;
  return Math.min(1, closeness * 0.9 + ramp);
}

export function scorePair(current: TrackFeatures | null, candidate: TrackFeatures | null, context: ScoreContext = {}): number {
  let tempo = NEUTRAL;
  let key = NEUTRAL;
  let energy = NEUTRAL;

  if (current && candidate) {
    if (current.bpm && candidate.bpm) tempo = tempoAffinity(current.bpm, candidate.bpm);
    if (current.camelot && candidate.camelot) key = camelotAffinity(current.camelot, candidate.camelot);
    if (current.energy != null && candidate.energy != null) energy = energyAffinity(current.energy, candidate.energy);
  }

  let score = tempo * 0.5 + key * 0.3 + energy * 0.2;

  if (candidate && context.recentVideoIds) {
    const position = context.recentVideoIds.indexOf(candidate.videoId);
    if (position >= 0) score *= 0.3 + 0.5 * Math.min(1, position / 20);
  }
  if (context.currentAuthor && context.candidateAuthor && context.currentAuthor === context.candidateAuthor) {
    score *= 0.75;
  }
  return score;
}
