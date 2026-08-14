import { describe, expect, it } from "vitest";
import { fadeStartSeconds, planTransition } from "../src/addons/bundled/dj/transition-plan";
import type { TrackFeatures } from "../src/addons/bundled/dj/feature-db";

function features(overrides: Partial<TrackFeatures> = {}): TrackFeatures {
  return {
    videoId: "vid",
    title: null,
    author: null,
    bpm: 120,
    durationS: 200,
    beatOffsetS: 0.25,
    analysisVersion: 1,
    analyzedAt: 0,
    ...overrides
  };
}

const DEFAULTS = { fadeOutS: 5, fadeInS: 1.5 };

describe("dj transition plan", () => {
  it("carries the outgoing beat grid when it is trustworthy", () => {
    const plan = planTransition(features(), features(), DEFAULTS);
    expect(plan.beatOffsetS).toBe(0.25);
    expect(plan.beatPeriodS).toBeCloseTo(0.5);
  });

  it("drops the grid for missing or absurd tempos", () => {
    expect(planTransition(features({ bpm: null }), null, DEFAULTS).beatOffsetS).toBeNull();
    expect(planTransition(features({ bpm: 300 }), null, DEFAULTS).beatOffsetS).toBeNull();
    expect(planTransition(features({ beatOffsetS: null }), null, DEFAULTS).beatOffsetS).toBeNull();
  });

  it("extends the blend for tempo-matched pairs and caps it", () => {
    const matched = planTransition(features({ bpm: 128 }), features({ bpm: 128.5 }), DEFAULTS);
    expect(matched.fadeOutS).toBeCloseTo(7.5);
    const capped = planTransition(features({ bpm: 128 }), features({ bpm: 128 }), { fadeOutS: 10, fadeInS: 2 });
    expect(capped.fadeOutS).toBe(12);
    const unmatched = planTransition(features({ bpm: 128 }), features({ bpm: 100 }), DEFAULTS);
    expect(unmatched.fadeOutS).toBe(5);
  });

  it("extends the blend for a pair detected an octave apart", () => {
    // Tempo detection lands on half time often enough that judging the pair on
    // the raw ratio would deny the longer blend to identical tempos.
    const plan = planTransition(features({ bpm: 70 }), features({ bpm: 140 }), DEFAULTS);
    expect(plan.fadeOutS).toBe(7.5);
    expect(plan.incomingRate).toBeNull();
  });

  it("snaps the fade start to the last downbeat before the window", () => {
    const plan = planTransition(features({ bpm: 120, beatOffsetS: 0.25 }), null, DEFAULTS);
    // duration 200, fadeOut 5 -> unaligned 195; grid 0.25 + n*0.5 -> 194.75
    expect(fadeStartSeconds(200, plan)).toBeCloseTo(194.75);
  });

  it("falls back to the plain window without a grid", () => {
    const plan = planTransition(features({ bpm: null }), null, DEFAULTS);
    expect(fadeStartSeconds(200, plan)).toBe(195);
  });

  it("stretches the incoming track toward the outgoing tempo within limits", () => {
    const close = planTransition(features({ bpm: 128 }), features({ bpm: 126 }), DEFAULTS);
    expect(close.incomingRate).toBeCloseTo(128 / 126);

    const slower = planTransition(features({ bpm: 120 }), features({ bpm: 126 }), DEFAULTS);
    expect(slower.incomingRate).toBeCloseTo(120 / 126);

    const far = planTransition(features({ bpm: 128 }), features({ bpm: 100 }), DEFAULTS);
    expect(far.incomingRate).toBeNull();
  });

  it("needs no stretch for a clean half-time pair", () => {
    const plan = planTransition(features({ bpm: 128 }), features({ bpm: 64 }), DEFAULTS);
    expect(plan.incomingRate).toBeNull();
  });
});
