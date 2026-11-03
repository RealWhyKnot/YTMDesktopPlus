import { afterEach, describe, expect, it, vi } from "vitest";
import { runScript } from "../../src/addons/bundled/volume-boost/scripts/boost.script";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("stored volume boost", () => {
  it.each([
    { raw: null, expected: 100 },
    { raw: "", expected: 100 },
    { raw: "12px", expected: 12 },
    { raw: "1.5", expected: 1 },
    { raw: " 7 ", expected: 7 },
    { raw: "3beta", expected: 3 },
    { raw: "0x10", expected: 0 },
    { raw: "-0", expected: 0 },
    { raw: "175px", expected: 175 },
    { raw: "9".repeat(400), expected: 100 },
  ])("restores '$raw' as $expected", ({ raw, expected }) => {
    const state = { level: 100, limiterWired: true, boost: { gain: { setTargetAtTime: vi.fn() } } };
    vi.stubGlobal("window", {
      __ytmdVolumeBoost: state,
      __ytmdVolumeBoostDelegated: true,
      __ytmdEnsureAudioGraph: () => ({ context: { currentTime: 0 } }),
      localStorage: { getItem: () => raw },
    });
    expect(runScript({ ceiling: 200 })).toBe(true);
    expect(state.level).toBe(expected);
  });
});
