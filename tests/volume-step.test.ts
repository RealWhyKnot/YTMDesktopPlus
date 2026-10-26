import { describe, expect, it } from "vitest";
import { steppedVolume, VOLUME_STEP } from "../src/renderer/ytmview/volume-step";

describe("steppedVolume", () => {
  it("steps by ten in both directions", () => {
    expect(steppedVolume(50, VOLUME_STEP)).toBe(60);
    expect(steppedVolume(50, -VOLUME_STEP)).toBe(40);
  });

  it("stops at the top instead of passing it", () => {
    expect(steppedVolume(95, VOLUME_STEP)).toBe(100);
    expect(steppedVolume(100, VOLUME_STEP)).toBe(100);
  });

  it("stops at the bottom instead of going negative", () => {
    expect(steppedVolume(5, -VOLUME_STEP)).toBe(0);
    expect(steppedVolume(0, -VOLUME_STEP)).toBe(0);
  });

  it("refuses a volume it cannot read", () => {
    expect(steppedVolume(Number.NaN, VOLUME_STEP)).toBeNull();
  });
});
