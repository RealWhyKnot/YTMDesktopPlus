import { afterEach, describe, expect, it, vi } from "vitest";
import { playerBarProbeSource, pollUntil, storeHookProbeSource, type PlayerBarProbeSnapshot } from "../src/shared/hook-probes";
import { PLAYER_API_MEMBERS } from "../src/shared/ytm-contract";

// The probe sources are strings evaluated in the YTM page. Compile them the
// same way the preload does to make sure they stay valid expressions.
const compileProbe = <T>(source: string): (() => T) => new Function(`return (${source});`)() as () => T;

const missingExcept = (...present: string[]): string[] => PLAYER_API_MEMBERS.filter(name => !present.includes(name));

const fullApi = (): Record<string, unknown> => Object.fromEntries(PLAYER_API_MEMBERS.map(name => [name, (): boolean => true]));

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
    vi.stubGlobal("document", { querySelector: (): null => null });
    expect(compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)()).toEqual({
      playerBarPresent: false,
      playerApiPresent: false,
      playerApiReady: false,
      resolverPresent: false,
      resolveError: null,
      resolvedVia: null,
      candidateKeys: [],
      missingMembers: []
    });
  });

  it("does not throw when the player api is missing", () => {
    vi.stubGlobal("document", { querySelector: () => ({}) });
    expect(compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)()).toEqual({
      playerBarPresent: true,
      playerApiPresent: false,
      playerApiReady: false,
      resolverPresent: false,
      resolveError: null,
      resolvedVia: null,
      candidateKeys: [],
      missingMembers: []
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
      playerApiReady: false,
      resolverPresent: false,
      resolveError: null,
      resolvedVia: "property",
      candidateKeys: [],
      missingMembers: missingExcept("isReady")
    });
  });

  it("reports ready when the player api is ready", () => {
    vi.stubGlobal("document", { querySelector: () => ({ playerApi: fullApi() }) });
    expect(compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)()).toEqual({
      playerBarPresent: true,
      playerApiPresent: true,
      playerApiReady: true,
      resolverPresent: false,
      resolveError: null,
      resolvedVia: "property",
      candidateKeys: [],
      missingMembers: []
    });
  });

  it("names the members a resolved api is missing", () => {
    const api = fullApi();
    delete api.setVolume;
    delete api.seekTo;
    vi.stubGlobal("document", { querySelector: () => ({ playerApi: api }) });
    expect(compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)().missingMembers).toEqual(["seekTo", "setVolume"]);
  });

  it("assigns playerApi from resolvePlayerApi and reports ready on the next poll", async () => {
    const api = { isReady: () => true };
    const bar: Record<string, unknown> = { resolvePlayerApi: () => Promise.resolve(api) };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource);
    expect(probe()).toEqual({
      playerBarPresent: true,
      playerApiPresent: false,
      playerApiReady: false,
      resolverPresent: true,
      resolveError: null,
      resolvedVia: null,
      candidateKeys: ["resolvePlayerApi"],
      missingMembers: []
    });
    await Promise.resolve();
    expect(bar.playerApi).toBe(api);
    const second = probe();
    expect(second.playerApiReady).toBe(true);
    expect(second.resolvedVia).toBe("resolver");
  });

  it("adopts a renamed playerApi property found by the scan", () => {
    const api = fullApi();
    const bar: Record<string, unknown> = { musicPlayerApi: api };
    vi.stubGlobal("document", { querySelector: () => bar });
    const snapshot = compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)();
    expect(snapshot.resolvedVia).toBe("scan");
    expect(snapshot.playerApiReady).toBe(true);
    expect(bar.playerApi).toBe(api);
  });

  it("adopts a renamed resolver whose result duck-types", async () => {
    const api = fullApi();
    const bar: Record<string, unknown> = { getPlayerApiRef: () => Promise.resolve(api) };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource);
    expect(probe().resolverPresent).toBe(true);
    await Promise.resolve();
    expect(bar.playerApi).toBe(api);
    expect(probe().resolvedVia).toBe("resolver");
  });

  it("rejects a renamed resolver whose result is not an api", async () => {
    const bar: Record<string, unknown> = { getPlayerApiRef: () => Promise.resolve({ isReady: () => true }) };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource);
    probe();
    await Promise.resolve();
    expect(bar.playerApi).toBeUndefined();
  });

  it("ignores candidates that take arguments or are named like event handlers", () => {
    const api = fullApi();
    const bar: Record<string, unknown> = {
      getPlayerApiRef: (which: string) => (which === "" ? null : api),
      onPlayerApiReady: () => api
    };
    vi.stubGlobal("document", { querySelector: () => bar });
    expect(compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)().resolverPresent).toBe(false);
  });

  it("falls back to #movie_player when the player bar carries nothing", () => {
    const api = fullApi();
    const bar: Record<string, unknown> = {};
    vi.stubGlobal("document", { querySelector: (selector: string) => (selector === "#movie_player" ? api : bar) });
    const snapshot = compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)();
    expect(snapshot.resolvedVia).toBe("movie-player");
    expect(bar.playerApi).toBe(api);
  });

  it("reports the element's own player-ish keys when nothing resolves", () => {
    const bar: Record<string, unknown> = { playerState_: 3, apiHost: "x", unrelated: 1 };
    vi.stubGlobal("document", { querySelector: () => bar });
    const snapshot = compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)();
    expect(snapshot.resolvedVia).toBeNull();
    expect(snapshot.candidateKeys).toEqual(["playerState_", "apiHost"]);
  });

  it("only calls resolvePlayerApi once while a resolution is pending", async () => {
    let calls = 0;
    const bar: Record<string, unknown> = {
      resolvePlayerApi: () => {
        calls++;
        return new Promise(() => {});
      }
    };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource);
    probe();
    probe();
    expect(calls).toBe(1);
  });

  it("reports a rejected resolvePlayerApi and retries on the next poll", async () => {
    let calls = 0;
    const bar: Record<string, unknown> = {
      resolvePlayerApi: () => {
        calls++;
        return Promise.reject(new Error("player gone"));
      }
    };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource);
    probe();
    await Promise.resolve();
    await Promise.resolve();
    const snapshot = probe();
    expect(snapshot.resolveError).toContain("player gone");
    expect(snapshot.playerApiPresent).toBe(false);
    expect(calls).toBe(2);
  });

  it("does not clobber an existing synchronous playerApi", () => {
    const api = { isReady: () => true };
    const bar: Record<string, unknown> = {
      playerApi: api,
      resolvePlayerApi: () => Promise.resolve({ isReady: () => true })
    };
    vi.stubGlobal("document", { querySelector: () => bar });
    const snapshot = compileProbe<PlayerBarProbeSnapshot>(playerBarProbeSource)();
    expect(snapshot.playerApiReady).toBe(true);
    expect(bar.playerApi).toBe(api);
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
