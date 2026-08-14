import { describe, expect, it } from "vitest";
import { energyAffinity, scorePair, tempoAffinity, type TrackFeatures } from "../src/addons/bundled/dj/scoring";

function features(overrides: Partial<TrackFeatures> = {}): TrackFeatures {
  return {
    videoId: "vid",
    title: null,
    author: null,
    bpm: 128,
    camelot: "8B",
    keyConfidence: 1,
    energy: 0.5,
    durationS: 200,
    beatOffsetS: 0.2,
    analysisVersion: 1,
    analyzedAt: 0,
    ...overrides
  };
}

describe("dj scoring", () => {
  it("scores identical tempos perfectly, including half and double time", () => {
    expect(tempoAffinity(128, 128)).toBeCloseTo(1);
    expect(tempoAffinity(128, 64)).toBeCloseTo(1);
    expect(tempoAffinity(70, 140)).toBeCloseTo(1);
  });

  it("tolerates small tempo drift and rejects big jumps", () => {
    expect(tempoAffinity(128, 131)).toBeGreaterThan(0.7);
    expect(tempoAffinity(128, 100)).toBeLessThan(0.05);
  });

  it("prefers building energy over dropping it", () => {
    expect(energyAffinity(0.5, 0.6)).toBeGreaterThan(energyAffinity(0.5, 0.4));
  });

  it("scores a compatible pair far above an incompatible one", () => {
    const current = features();
    const good = features({ videoId: "good", bpm: 126, camelot: "9B", energy: 0.55 });
    const bad = features({ videoId: "bad", bpm: 95, camelot: "3A", energy: 0.1 });
    expect(scorePair(current, good)).toBeGreaterThan(0.8);
    expect(scorePair(current, bad)).toBeLessThan(0.3);
  });

  it("stays neutral when either side is unanalyzed", () => {
    expect(scorePair(null, features())).toBeCloseTo(0.5);
    expect(scorePair(features(), null)).toBeCloseTo(0.5);
  });

  it("penalizes recently played tracks, fading with distance", () => {
    const current = features();
    const candidate = features({ videoId: "candidate" });
    const fresh = scorePair(current, candidate);
    const justPlayed = scorePair(current, candidate, { recentVideoIds: ["candidate"] });
    const playedAWhileAgo = scorePair(current, candidate, { recentVideoIds: [...Array(19).fill("x"), "candidate"] });
    expect(justPlayed).toBeLessThan(fresh * 0.4);
    expect(playedAWhileAgo).toBeGreaterThan(justPlayed);
  });

  it("penalizes repeating the same artist", () => {
    const current = features();
    const candidate = features({ videoId: "candidate" });
    const different = scorePair(current, candidate, { currentAuthor: "A", candidateAuthor: "B" });
    const same = scorePair(current, candidate, { currentAuthor: "A", candidateAuthor: "A" });
    expect(same).toBeCloseTo(different * 0.75);
  });
});
