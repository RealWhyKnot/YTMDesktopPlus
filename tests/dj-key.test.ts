import { describe, expect, it } from "vitest";
import { camelotAffinity, estimateKey, keyName } from "../src/addons/bundled/dj/key";

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// A track in key `tonic` has the profile's tonic bin sitting at index `tonic`.
function chromaFor(profile: number[], tonic: number): number[] {
  const chroma = new Array<number>(12);
  for (let i = 0; i < 12; i++) chroma[(i + tonic) % 12] = profile[i];
  return chroma;
}

describe("dj key estimation", () => {
  it("recovers all 24 keys from clean profile chromas", () => {
    for (let tonic = 0; tonic < 12; tonic++) {
      const major = estimateKey(chromaFor(MAJOR_PROFILE, tonic));
      expect(major).toMatchObject({ tonic, scale: "major" });
      const minor = estimateKey(chromaFor(MINOR_PROFILE, tonic));
      expect(minor).toMatchObject({ tonic, scale: "minor" });
    }
  });

  it("maps the reference keys onto the Camelot wheel", () => {
    expect(estimateKey(chromaFor(MAJOR_PROFILE, 0))?.camelot).toBe("8B");
    expect(estimateKey(chromaFor(MINOR_PROFILE, 9))?.camelot).toBe("8A");
    expect(estimateKey(chromaFor(MAJOR_PROFILE, 7))?.camelot).toBe("9B");
    expect(estimateKey(chromaFor(MINOR_PROFILE, 4))?.camelot).toBe("9A");
  });

  it("survives noise on top of the profile", () => {
    const noisy = chromaFor(MAJOR_PROFILE, 5).map((v, i) => v + (((i * 7) % 5) - 2) * 0.3);
    const estimate = estimateKey(noisy);
    expect(estimate).toMatchObject({ tonic: 5, scale: "major" });
    expect(estimate!.confidence).toBeGreaterThan(0.7);
  });

  it("names keys for humans", () => {
    expect(keyName(estimateKey(chromaFor(MAJOR_PROFILE, 0))!)).toBe("C major");
    expect(keyName(estimateKey(chromaFor(MINOR_PROFILE, 9))!)).toBe("A minor");
  });

  it("refuses silence and malformed input", () => {
    expect(estimateKey(new Array(12).fill(0))).toBeNull();
    expect(estimateKey([1, 2, 3])).toBeNull();
    expect(estimateKey(chromaFor(MAJOR_PROFILE, 0).map((v, i) => (i === 3 ? NaN : v)))).toBeNull();
  });

  it("ranks Camelot affinities the harmonic-mixing way", () => {
    expect(camelotAffinity("8B", "8B")).toBe(1);
    expect(camelotAffinity("8B", "8A")).toBe(0.85);
    expect(camelotAffinity("8B", "9B")).toBe(0.9);
    expect(camelotAffinity("8B", "7B")).toBe(0.9);
    expect(camelotAffinity("8B", "10B")).toBe(0.5);
    expect(camelotAffinity("8B", "2A")).toBe(0.2);
    expect(camelotAffinity("12B", "1B")).toBe(0.9);
    expect(camelotAffinity("8B", "not-a-key")).toBe(0.2);
  });
});
