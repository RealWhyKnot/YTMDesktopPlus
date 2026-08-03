import { afterEach, describe, expect, it, vi } from "vitest";
import { playerBarProbeSource, pollUntil, storeHookProbeSource, type PlayerBarProbeSnapshot } from "../src/shared/hook-probes";

// The probe sources are strings evaluated in the YTM page. Compile them the
// same way the preload does to make sure they stay valid expressions.
const compileProbe = <T>(source: string): (() => T) => new Function(`return (${source});`)() as () => T;

describe("storeHookProbeSource", () => {
  it("reports false when the hook is missing", () => {
    vi.stubGlobal("window", {});
    expect(compileProbe<boolean>(storeHookProbeSource)()).toBe(false);
  });

  it("reports true when the hook is installed", () => {
    vi.stubGlobal("window", { __YTMD_HOOK__: { ytmStore: {} } });
    expect(compileProbe<boolean>(storeHookProbeSource)()).toBe(true);
  });
});

describe("playerBarProbeSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not throw when the player bar is missing", () => {
    vi.stubGlobal("document", { querySelector: () => null });
    expect(compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)()).toEqual({
      playerBarPresent: false,
      playerApiPresent: false,
      playerApiReady: false
    });
  });

  it("does not throw when the player api is missing", () => {
    vi.stubGlobal("document", { querySelector: () => ({}) });
    expect(compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)()).toEqual({
      playerBarPresent: true,
      playerApiPresent: false,
      playerApiReady: false
    });
  });

  it("does not throw when isReady itself throws", () => {
    vi.stubGlobal("document", {
      querySelector: () => ({
        playerApi: {
          isReady: () => {
            throw new Error("not ready");
          }
        }
      })
    });
    expect(compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)()).toEqual({
      playerBarPresent: true,
      playerApiPresent: true,
      playerApiReady: false
    });
  });

  it("reports ready when the player api is ready", () => {
    vi.stubGlobal("document", { querySelector: () => ({ playerApi: { isReady: () => true } }) });
    expect(compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)()).toEqual({
      playerBarPresent: true,
      playerApiPresent: true,
      playerApiReady: true
    });
  });
});

describe("pollUntil", () => {
  it("resolves immediately when the first probe succeeds", async () => {
    const result = await pollUntil(
      async () => true,
      done => done,
      1,
      5
    );
    expect(result).toEqual({ done: true, attempts: 1, last: true, lastError: null });
  });

  it("treats a throwing probe as a failed attempt instead of rejecting", async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls++;
        throw new Error("probe exploded");
      },
      () => true,
      1,
      3
    );
    expect(calls).toBe(3);
    expect(result.done).toBe(false);
    expect(result.lastError).toContain("probe exploded");
  });

  it("recovers when a probe throws and then succeeds", async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls++;
        if (calls === 1) throw new Error("transient");
        return true;
      },
      done => done,
      1,
      5
    );
    expect(result.done).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.lastError).toBeNull();
  });

  it("keeps polling until the probe succeeds", async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls++;
        return calls >= 3;
      },
      done => done,
      1,
      5
    );
    expect(result.done).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it("gives up after maxAttempts and reports the last snapshot", async () => {
    let calls = 0;
    const result = await pollUntil(
      async () => {
        calls++;
        return { seen: calls };
      },
      () => false,
      1,
      4
    );
    expect(calls).toBe(4);
    expect(result).toEqual({ done: false, attempts: 4, last: { seen: 4 }, lastError: null });
  });
});
