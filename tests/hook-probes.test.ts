import { evaluatePageScript } from "./helpers/page-script";
import { isBoolean, type Guard } from "../src/shared/validation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playerBarProbeSource, pollUntil, storeHookProbeSource, isPlayerBarProbeSnapshot } from "../src/shared/hook-probes";
import { PLAYER_API_MEMBERS } from "../src/shared/ytm-contract";

function compileProbe<T>(source: string, guard: Guard<T>): () => T {
  const script = evaluatePageScript(source);
  if (typeof script !== "function") throw new TypeError("Expected a callable probe");
  return () => {
    const value: unknown = Reflect.apply(script, undefined, []);
    if (!guard(value)) throw new TypeError("Invalid probe result");
    return value;
  };
}

const missingExcept = (...present: string[]): string[] => PLAYER_API_MEMBERS.filter((name) => !present.includes(name));

const fullApi = (): Record<string, unknown> => Object.fromEntries(PLAYER_API_MEMBERS.map((name) => [name, (): boolean => true]));

describe("storeHookProbeSource", () => {
  it("reports false when the hook is missing", () => {
    vi.stubGlobal("window", {});
    expect(compileProbe(storeHookProbeSource, isBoolean)()).toBe(false);
  });

  it("reports true when the hook is installed", () => {
    vi.stubGlobal("window", { __YTMD_HOOK__: { ytmStore: {} } });
    expect(compileProbe(storeHookProbeSource, isBoolean)()).toBe(true);
  });
});

describe("playerBarProbeSource", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not throw when the player bar is missing", () => {
    vi.stubGlobal("document", { querySelector: (): null => null });
    expect(compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)()).toEqual({
      playerBarPresent: false,
      miniplayerPresent: false,
      playerApiPresent: false,
      playerApiReady: false,
      resolverPresent: false,
      resolveError: null,
      resolvedVia: null,
      candidateKeys: [],
      missingMembers: [],
    });
  });

  it("names the miniplayer when it took the player bar's place", () => {
    vi.stubGlobal("document", { querySelector: (selector: string) => (selector === "ytmusic-app-layout>ytmusic-miniplayer" ? {} : null) });
    const snapshot = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)();
    expect(snapshot.playerBarPresent).toBe(false);
    expect(snapshot.miniplayerPresent).toBe(true);
    expect(snapshot.playerApiReady).toBe(false);
  });

  it("does not throw when the player api is missing", () => {
    vi.stubGlobal("document", { querySelector: () => ({}) });
    expect(compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)()).toEqual({
      playerBarPresent: true,
      miniplayerPresent: false,
      playerApiPresent: false,
      playerApiReady: false,
      resolverPresent: false,
      resolveError: null,
      resolvedVia: null,
      candidateKeys: [],
      missingMembers: [],
    });
  });

  it("does not throw when isReady itself throws", () => {
    vi.stubGlobal("document", {
      querySelector: () => ({
        playerApi: {
          isReady: () => {
            throw new Error("not ready");
          },
        },
      }),
    });
    expect(compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)()).toEqual({
      playerBarPresent: true,
      miniplayerPresent: false,
      playerApiPresent: true,
      playerApiReady: false,
      resolverPresent: false,
      resolveError: null,
      resolvedVia: "property",
      candidateKeys: [],
      missingMembers: missingExcept("isReady"),
    });
  });

  it("reports ready when the player api is ready", () => {
    vi.stubGlobal("document", { querySelector: () => ({ playerApi: fullApi() }) });
    expect(compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)()).toEqual({
      playerBarPresent: true,
      miniplayerPresent: false,
      playerApiPresent: true,
      playerApiReady: true,
      resolverPresent: false,
      resolveError: null,
      resolvedVia: "property",
      candidateKeys: [],
      missingMembers: [],
    });
  });

  it("names the members a resolved api is missing", () => {
    const api = fullApi();
    delete api.setVolume;
    delete api.seekTo;
    vi.stubGlobal("document", { querySelector: () => ({ playerApi: api }) });
    expect(compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)().missingMembers).toEqual(["seekTo", "setVolume"]);
  });

  it("assigns playerApi from resolvePlayerApi and reports ready on the next poll", async () => {
    const api = { isReady: () => true };
    const bar = { resolvePlayerApi: () => Promise.resolve(api) };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot);
    expect(probe()).toEqual({
      playerBarPresent: true,
      miniplayerPresent: false,
      playerApiPresent: false,
      playerApiReady: false,
      resolverPresent: true,
      resolveError: null,
      resolvedVia: null,
      candidateKeys: ["resolvePlayerApi"],
      missingMembers: [],
    });
    await Promise.resolve();
    expect(Reflect.get(bar, "playerApi")).toBe(api);
    const second = probe();
    expect(second.playerApiReady).toBe(true);
    expect(second.resolvedVia).toBe("resolver");
  });

  it("adopts a renamed playerApi property found by the scan", () => {
    const api = fullApi();
    const bar = { musicPlayerApi: api };
    vi.stubGlobal("document", { querySelector: () => bar });
    const snapshot = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)();
    expect(snapshot.resolvedVia).toBe("scan");
    expect(snapshot.playerApiReady).toBe(true);
    expect(Reflect.get(bar, "playerApi")).toBe(api);
  });

  it("adopts a renamed resolver whose result duck-types", async () => {
    const api = fullApi();
    const bar = { getPlayerApiRef: () => Promise.resolve(api) };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot);
    expect(probe().resolverPresent).toBe(true);
    await Promise.resolve();
    expect(Reflect.get(bar, "playerApi")).toBe(api);
    expect(probe().resolvedVia).toBe("resolver");
  });

  it("rejects a renamed resolver whose result is not an api", async () => {
    const bar = { getPlayerApiRef: () => Promise.resolve({ isReady: () => true }) };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot);
    probe();
    await Promise.resolve();
    expect(Reflect.get(bar, "playerApi")).toBeUndefined();
  });

  it("ignores candidates that take arguments or are named like event handlers", () => {
    const api = fullApi();
    const bar = {
      getPlayerApiRef: (which: string) => (which === "" ? null : api),
      onPlayerApiReady: () => api,
    };
    vi.stubGlobal("document", { querySelector: () => bar });
    expect(compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)().resolverPresent).toBe(false);
  });

  it("falls back to #movie_player when the player bar carries nothing", () => {
    const api = fullApi();
    const bar = {};
    vi.stubGlobal("document", { querySelector: (selector: string) => (selector === "#movie_player" ? api : bar) });
    const snapshot = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)();
    expect(snapshot.resolvedVia).toBe("movie-player");
    expect(Reflect.get(bar, "playerApi")).toBe(api);
  });

  it("reports the element's own player-ish keys when nothing resolves", () => {
    const bar = { playerState_: 3, apiHost: "x", unrelated: 1 };
    vi.stubGlobal("document", { querySelector: () => bar });
    const snapshot = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)();
    expect(snapshot.resolvedVia).toBeNull();
    expect(snapshot.candidateKeys).toEqual(["playerState_", "apiHost"]);
  });

  it("only calls resolvePlayerApi once while a resolution is pending", () => {
    let calls = 0;
    const bar = {
      resolvePlayerApi: () => {
        calls++;
        return new Promise(() => {
          return undefined;
        });
      },
    };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot);
    probe();
    probe();
    expect(calls).toBe(1);
  });

  it("reports a rejected resolvePlayerApi and retries on the next poll", async () => {
    let calls = 0;
    const bar = {
      resolvePlayerApi: () => {
        calls++;
        return Promise.reject(new Error("player gone"));
      },
    };
    vi.stubGlobal("document", { querySelector: () => bar });
    const probe = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot);
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
    const bar = {
      playerApi: api,
      resolvePlayerApi: () => Promise.resolve({ isReady: () => true }),
    };
    vi.stubGlobal("document", { querySelector: () => bar });
    const snapshot = compileProbe(playerBarProbeSource, isPlayerBarProbeSnapshot)();
    expect(snapshot.playerApiReady).toBe(true);
    expect(Reflect.get(bar, "playerApi")).toBe(api);
  });
});

describe("pollUntil", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it("resolves immediately when the first probe succeeds", async () => {
    const polling = pollUntil(
      () => Promise.resolve(true),
      (isDone) => isDone,
      1,
      5
    );
    await vi.runAllTimersAsync();
    const result = await polling;
    expect(result).toEqual({ done: true, attempts: 1, last: true, lastError: null });
  });

  it("treats a throwing probe as a failed attempt instead of rejecting", async () => {
    let calls = 0;
    const polling = pollUntil(
      () => {
        calls++;
        return Promise.reject(new Error("probe exploded"));
      },
      () => true,
      1,
      3
    );
    await vi.runAllTimersAsync();
    const result = await polling;
    expect(calls).toBe(3);
    expect(result.done).toBe(false);
    expect(result.lastError).toContain("probe exploded");
  });

  it("recovers when a probe throws and then succeeds", async () => {
    let calls = 0;
    const polling = pollUntil(
      () => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("transient"));
        return Promise.resolve(true);
      },
      (isDone) => isDone,
      1,
      5
    );
    await vi.runAllTimersAsync();
    const result = await polling;
    expect(result.done).toBe(true);
    expect(result.attempts).toBe(2);
    expect(result.lastError).toBeNull();
  });

  it("keeps polling until the probe succeeds", async () => {
    let calls = 0;
    const polling = pollUntil(
      () => {
        calls++;
        return Promise.resolve(calls >= 3);
      },
      (isDone) => isDone,
      1,
      5
    );
    await vi.runAllTimersAsync();
    const result = await polling;
    expect(result.done).toBe(true);
    expect(result.attempts).toBe(3);
  });

  it("gives up after maxAttempts and reports the last snapshot", async () => {
    let calls = 0;
    const polling = pollUntil(
      () => {
        calls++;
        return Promise.resolve({ seen: calls });
      },
      () => false,
      1,
      4
    );
    await vi.runAllTimersAsync();
    const result = await polling;
    expect(calls).toBe(4);
    expect(result).toEqual({ done: false, attempts: 4, last: { seen: 4 }, lastError: null });
  });
});
