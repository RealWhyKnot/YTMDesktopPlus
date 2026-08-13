// Turns two feature records into concrete fade timing for the page engine.
// With a beat grid on the outgoing track the fade start snaps to a downbeat;
// without one it falls back to the configured window unchanged.

import type { TrackFeatures } from "./scoring";

export type TransitionPlan = {
  fadeOutS: number;
  fadeInS: number;
  // When set, the page engine aligns the fade start to outgoing beats:
  // start at the last grid point <= (duration - fadeOutS).
  beatOffsetS: number | null;
  beatPeriodS: number | null;
  // Playback rate the incoming track starts at so its tempo matches the
  // outgoing one, gliding back to 1 over rateGlideS. Null when the tempos are
  // too far apart to stretch convincingly.
  incomingRate: number | null;
  rateGlideS: number;
};

const MAX_STRETCH = 0.06;
const RATE_GLIDE_S = 6;

export function planTransition(current: TrackFeatures | null, next: TrackFeatures | null, defaults: { fadeOutS: number; fadeInS: number }): TransitionPlan {
  const plan: TransitionPlan = {
    fadeOutS: defaults.fadeOutS,
    fadeInS: defaults.fadeInS,
    beatOffsetS: null,
    beatPeriodS: null,
    incomingRate: null,
    rateGlideS: RATE_GLIDE_S
  };
  if (current?.bpm && current.beatOffsetS != null && current.bpm >= 40 && current.bpm <= 240) {
    plan.beatOffsetS = current.beatOffsetS;
    plan.beatPeriodS = 60 / current.bpm;
  }
  // Two analyzed, tempo-close tracks earn a longer blend; unknown pairs keep
  // the configured fade so the failure mode is the ordinary crossfade.
  if (current?.bpm && next?.bpm) {
    const ratio = Math.abs(Math.log2(next.bpm / current.bpm));
    if (ratio < 0.03) plan.fadeOutS = Math.min(12, defaults.fadeOutS * 1.5);

    // Stretch against the nearest half/double interpretation of the incoming
    // tempo, so 64 under a 128 outgoing needs no stretch at all.
    let bestMultiple = 1;
    let bestDistance = Infinity;
    for (const multiple of [0.5, 1, 2]) {
      const distance = Math.abs(Math.log2((next.bpm * multiple) / current.bpm));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMultiple = multiple;
      }
    }
    const rate = current.bpm / (next.bpm * bestMultiple);
    if (rate !== 1 && Math.abs(Math.log2(rate)) <= Math.log2(1 + MAX_STRETCH)) plan.incomingRate = rate;
  }
  return plan;
}

// The concrete moment (in track time) the fade should start, beat-aligned
// when the plan carries a grid. Pure so the page-side rounding is testable.
export function fadeStartSeconds(durationS: number, plan: TransitionPlan): number {
  const unaligned = durationS - plan.fadeOutS;
  if (plan.beatOffsetS == null || plan.beatPeriodS == null || plan.beatPeriodS <= 0) return unaligned;
  if (unaligned <= plan.beatOffsetS) return unaligned;
  const beats = Math.floor((unaligned - plan.beatOffsetS) / plan.beatPeriodS);
  return plan.beatOffsetS + beats * plan.beatPeriodS;
}
