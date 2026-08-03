import { describe, expect, it } from "vitest";
import { gainFromLoudnessDb } from "../src/shared/loudness";

describe("gainFromLoudnessDb", () => {
  it("attenuates tracks above the loudness target", () => {
    expect(gainFromLoudnessDb(6)).toBeCloseTo(0.501, 3);
    expect(gainFromLoudnessDb(3)).toBeCloseTo(0.708, 3);
    expect(gainFromLoudnessDb(20)).toBeCloseTo(0.1, 3);
  });

  it("never boosts quiet tracks", () => {
    expect(gainFromLoudnessDb(-6.01)).toBe(1);
    expect(gainFromLoudnessDb(0)).toBe(1);
  });

  it("passes through when the field is missing or junk", () => {
    expect(gainFromLoudnessDb(undefined)).toBe(1);
    expect(gainFromLoudnessDb(null)).toBe(1);
    expect(gainFromLoudnessDb("loud")).toBe(1);
    expect(gainFromLoudnessDb(Number.NaN)).toBe(1);
    expect(gainFromLoudnessDb(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
