import { isArray, isRecord } from "../src/shared/unknown";
import { callMethod } from "./helpers/call-method";
import { requireValue } from "./helpers/require-value";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockingContext, ElectronBlocker, Request } from "@ghostery/adblocker-electron";
import type { RequestType } from "@ghostery/adblocker-electron";
import { CACHE_MAX_AGE_MS, ENGINE_CONFIG, isCacheStale, LEGACY_CACHE_FILES } from "../src/main/integrations/ad-blocker/cache";
import { installAdPrune } from "../src/renderer/ytmview/ad-prune";
import { AD_PRUNE_CONTRACT } from "../src/shared/ad-contract";
import { AdBlocker, ENGINE_RETRY_MS } from "../src/main/integrations/ad-blocker";
import type { Session } from "electron";
import { makeTempDir } from "./helpers/temp-dir";

const NOW = 1_770_000_000_000;

function adPage(): Record<string, unknown> {
  const page: unknown = Reflect.get(globalThis, "window");
  if (!isRecord(page)) throw new Error("Missing ad test page");
  return page;
}

function pruneState(): { count: number; unknown: string[] } {
  const state = adPage().__ytmdAdPrune;
  if (!isRecord(state) || typeof state.count !== "number" || !isArray(state.unknown) || !state.unknown.every((key) => typeof key === "string")) {
    throw new Error("Invalid ad pruning state");
  }
  return { count: state.count, unknown: state.unknown };
}

describe("isCacheStale", () => {
  it("keeps a cache written moments ago", () => {
    expect(isCacheStale(NOW - 1000, NOW)).toBe(false);
  });

  it("keeps a cache written just inside the age limit", () => {
    expect(isCacheStale(NOW - CACHE_MAX_AGE_MS + 1000, NOW)).toBe(false);
  });

  it("drops a cache written past the age limit", () => {
    expect(isCacheStale(NOW - CACHE_MAX_AGE_MS - 1000, NOW)).toBe(true);
  });

  it("drops a cache stamped in the future", () => {
    expect(isCacheStale(NOW + 60_000, NOW)).toBe(true);
  });
});

describe("LEGACY_CACHE_FILES", () => {
  it("names the cosmetic-era engine so it gets deleted rather than read", () => {
    expect(LEGACY_CACHE_FILES).toContain("adblocker-engine.bin");
  });

  it("does not name the file the app writes now", () => {
    expect(LEGACY_CACHE_FILES).not.toContain("adblocker-engine-network.bin");
  });
});

describe("installAdPrune", () => {
  const nativeParse = JSON.parse;
  let events: [string, unknown][];
  let misses: string[];

  const playerResponse = (): Record<string, unknown> => ({
    playabilityStatus: { status: "OK" },
    streamingData: { formats: [{ itag: 251 }] },
    adPlacements: [],
    adSlots: [
      { slotType: "SLOT_TYPE_PLAYER_BYTES", slotRenderer: { playerBytesAdLayoutRenderer: {} } },
      { slotType: "SLOT_TYPE_IN_PLAYER", slotRenderer: { inPlayerAdLayoutRenderer: {} } },
      { slotType: "SLOT_TYPE_IN_PLAYER", slotRenderer: { inPlayerAdLayoutRenderer: {} } },
    ],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    videoDetails: { videoId: "dQw4w9WgXcQ" },
  });

  beforeEach(() => {
    events = [];
    misses = [];
    vi.stubGlobal("window", {
      ytmd: {
        sendAdBlockEvent: (kind: string, detail: unknown) => events.push([kind, detail]),
        reportContractMiss: (what: string) => misses.push(what),
      },
    });
  });

  afterEach(() => {
    JSON.parse = nativeParse;
    vi.unstubAllGlobals();
  });

  it("takes the ad keys out of a player response", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const parsed: unknown = JSON.parse(JSON.stringify(playerResponse()));

    expect(parsed).not.toHaveProperty("adSlots");
    expect(parsed).not.toHaveProperty("playerAds");
    expect(parsed).not.toHaveProperty("adPlacements");
    expect(parsed).toHaveProperty("videoDetails", { videoId: "dQw4w9WgXcQ" });
    expect(parsed).toHaveProperty("streamingData", { formats: [{ itag: 251 }] });
  });

  it("takes them out of a nested playerResponse too", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const parsed: unknown = JSON.parse(JSON.stringify({ playerResponse: playerResponse() }));

    expect(parsed).not.toHaveProperty("playerResponse.adSlots");
    expect(parsed).toHaveProperty("playerResponse.videoDetails", { videoId: "dQw4w9WgXcQ" });
  });

  it("leaves a payload with no ad keys exactly as it was", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const payload = { contents: { rows: [1, 2, 3] }, header: null };

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect(pruneState().count).toBe(0);
  });

  it("prunes nothing while the setting is off", () => {
    installAdPrune(false, AD_PRUNE_CONTRACT);

    expect(JSON.parse(JSON.stringify(playerResponse()))).toHaveProperty("adSlots");
  });

  it("prunes again once the setting is flipped back on", () => {
    installAdPrune(false, AD_PRUNE_CONTRACT);
    installAdPrune(true, AD_PRUNE_CONTRACT);

    expect(JSON.parse(JSON.stringify(playerResponse()))).not.toHaveProperty("adSlots");
  });

  it("keeps the reviver working", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const parsed: unknown = JSON.parse('{"a":1,"b":2}', (_key: string, value: unknown) => (typeof value === "number" ? value * 10 : value));

    expect(parsed).toEqual({ a: 10, b: 20 });
  });

  it("hands back the payload untouched rather than half pruned when a delete throws", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const frozen = Object.freeze({ adPlacements: [], adSlots: [{}] });
    const parsed: unknown = JSON.parse("{}", () => frozen);

    expect(parsed).toBe(frozen);
    expect(parsed).toHaveProperty("adSlots");
  });

  it("reports the first prune of the page load and no others", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify(playerResponse()));
    JSON.parse(JSON.stringify(playerResponse()));

    expect(events).toEqual([["pruned", ["adPlacements", "adSlots", "playerAds"]]]);
    expect(pruneState().count).toBe(2);
  });

  it("does not wrap JSON.parse twice", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);
    const wrapped = JSON.parse;
    installAdPrune(true, AD_PRUNE_CONTRACT);

    expect(JSON.parse).toBe(wrapped);
  });

  it("prunes the root and one playerResponse below it, no deeper", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const parsed: unknown = JSON.parse(
      JSON.stringify({ response: { playerResponse: playerResponse() }, playerResponse: { playerResponse: playerResponse() } })
    );

    expect(parsed).toHaveProperty("response.playerResponse.adSlots");
    expect(parsed).toHaveProperty("playerResponse.playerResponse.adSlots");
  });

  it("lets a parse error through rather than swallowing it", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    expect(() => {
      JSON.parse("{not json");
    }).toThrow();
  });

  it("hands back results that are not plain objects untouched", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    expect(JSON.parse("[1,2,3]")).toEqual([1, 2, 3]);
    expect(JSON.parse('"text"')).toBe("text");
    expect(JSON.parse("7")).toBe(7);
    expect(JSON.parse("null")).toBe(null);
  });
});

describe("ad key drift", () => {
  const nativeParse = JSON.parse;
  let misses: string[];
  let events: [string, unknown][];

  const known = (): Record<string, unknown> => ({
    adPlacements: [],
    adSlots: [{ slotType: "SLOT_TYPE_PLAYER_BYTES" }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
  });

  const response = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    playabilityStatus: { status: "OK" },
    streamingData: { formats: [{ itag: 251 }], adaptiveFormats: [{ itag: 140 }] },
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    ...extra,
  });

  beforeEach(() => {
    misses = [];
    events = [];
    vi.stubGlobal("window", {
      ytmd: {
        sendAdBlockEvent: (kind: string, detail: unknown) => events.push([kind, detail]),
        reportContractMiss: (what: string) => misses.push(what),
      },
    });
  });

  afterEach(() => {
    JSON.parse = nativeParse;
    vi.unstubAllGlobals();
  });

  it("names an ad key it does not recognise", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify(response({ adBreakHeartbeatParams: "x" })));

    expect(misses).toEqual(["player response ad key adBreakHeartbeatParams"]);
    expect(pruneState().unknown).toEqual(["adBreakHeartbeatParams"]);
  });

  it("names it once a page load rather than once a parse", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify(response({ adBreakHeartbeatParams: "x" })));
    JSON.parse(JSON.stringify(response({ adBreakHeartbeatParams: "x" })));

    expect(misses).toHaveLength(1);
  });

  it("reports a renamed playerAds key too", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify(response({ playerAdsV2: [] })));

    expect(misses).toEqual(["player response ad key playerAdsV2"]);
  });

  it("stays quiet on an ad free player response", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify(response()));

    expect(misses).toEqual([]);
  });

  it("stays quiet on the keys it already prunes", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify(response(known())));

    expect(misses).toEqual([]);
  });

  it("reports a new key that arrives beside the known ones", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify(response({ ...known(), adBreaks: [{}] })));

    expect(misses).toEqual(["player response ad key adBreaks"]);
    expect(events).toEqual([["pruned", ["adPlacements", "adSlots", "playerAds"]]]);
  });

  it("ignores ad shaped keys on payloads that are not player responses", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify({ contents: { rows: [] }, adBreaks: [{}] }));

    expect(misses).toEqual([]);
  });

  it("looks inside a nested playerResponse", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify({ playerResponse: response({ adBreaks: [{}] }) }));

    expect(misses).toEqual(["player response ad key adBreaks"]);
  });

  it("stays quiet while the setting is off", () => {
    installAdPrune(false, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify(response({ adBreaks: [{}] })));

    expect(misses).toEqual([]);
  });

  it("still records the prune when the drift report throws", () => {
    const page = adPage();
    if (!isRecord(page.ytmd)) throw new Error("Missing page bridge");
    page.ytmd.reportContractMiss = () => {
      throw new Error("ipc unavailable");
    };

    installAdPrune(true, AD_PRUNE_CONTRACT);

    const parsed: unknown = JSON.parse(JSON.stringify(response({ ...known(), adBreaks: [{}] })));

    expect(parsed).not.toHaveProperty("adSlots");
    expect(events).toEqual([["pruned", ["adPlacements", "adSlots", "playerAds"]]]);
    expect(pruneState().count).toBe(1);
  });
});

describe("engine options", () => {
  const FILTERS = ["music.youtube.com##ytmusic-popup-container", "||googleads.g.doubleclick.net^"];

  const build = (): ElectronBlocker => ElectronBlocker.parse(FILTERS.join("\n"), ENGINE_CONFIG);

  const matches = (engine: ElectronBlocker, url: string, type: RequestType): boolean =>
    engine.match(Request.fromRawDetails({ url, type, sourceUrl: "https://music.youtube.com/" })).match;

  it("keeps cosmetic filtering off", () => {
    expect(ENGINE_CONFIG.loadCosmeticFilters).toBe(false);
    expect(build().config.loadCosmeticFilters).toBe(false);
  });

  it("hands music.youtube.com no cosmetic rules to inject", () => {
    const cosmetics = build().getCosmeticsFilters({ url: "https://music.youtube.com/", hostname: "music.youtube.com", domain: "youtube.com" });

    expect(cosmetics.scripts).toEqual([]);
    expect(cosmetics.styles).toBe("");
  });

  it("still blocks network requests with cosmetics off", () => {
    expect(matches(build(), "https://googleads.g.doubleclick.net/pagead/id", "script")).toBe(true);
  });

  it("leaves the player endpoint and the media host alone", () => {
    const engine = build();

    expect(matches(engine, "https://music.youtube.com/youtubei/v1/player", "xhr")).toBe(false);
    expect(matches(engine, "https://rr3---sn-example.googlevideo.com/videoplayback?itag=251", "media")).toBe(false);
  });

  it("comes back off cosmetics after a cache round trip", () => {
    expect(ElectronBlocker.deserialize(build().serialize()).config.loadCosmeticFilters).toBe(false);
  });
});

describe("ad skip injection", () => {
  const build = () => {
    const sends: unknown[][] = [];
    const view = { webContents: { send: (...args: unknown[]) => sends.push(args), isDestroyed: () => false } };
    return { blocker: new AdBlocker(), view, sends };
  };

  it("waits for the view before injecting", () => {
    const { blocker, view, sends } = build();

    blocker.enable();
    callMethod(blocker, "provideView", view);

    expect(sends).toEqual([]);

    blocker.ytmViewLoaded();

    expect(sends).toEqual([["ytmView:executeScript", "adBlock", "enable"]]);
  });

  it("injects again for the next document the view loads", () => {
    const { blocker, view, sends } = build();

    blocker.enable();
    callMethod(blocker, "provideView", view);
    blocker.ytmViewLoaded();
    blocker.ytmViewLoaded();

    expect(sends).toHaveLength(2);
  });

  it("tears the page script down when the setting goes off", () => {
    const { blocker, view, sends } = build();

    blocker.enable();
    callMethod(blocker, "provideView", view);
    blocker.ytmViewLoaded();
    blocker.disable();

    expect(sends[1]).toEqual(["ytmView:executeScript", "adBlock", "disable"]);
  });

  it("injects nothing while the setting is off", () => {
    const { blocker, view, sends } = build();

    callMethod(blocker, "provideView", view);
    blocker.ytmViewLoaded();
    blocker.disable();

    expect(sends).toEqual([]);
  });

  it("stays quiet when the window took the view down with it", () => {
    const { blocker, view } = build();

    blocker.enable();
    callMethod(blocker, "provideView", view);
    blocker.ytmViewLoaded();
    Reflect.set(view, "webContents", undefined);

    expect(() => blocker.disable()).not.toThrow();
  });

  it("stays quiet when the view is destroyed", () => {
    const { blocker, view, sends } = build();

    callMethod(blocker, "provideView", view);
    blocker.ytmViewLoaded();
    view.webContents.isDestroyed = () => true;
    blocker.enable();

    expect(sends).toEqual([]);
  });

  it("serves both scripts to the page", () => {
    expect(new AdBlocker().getYTMScripts().map((entry) => entry.name)).toEqual(["enable", "disable"]);
  });
});

describe("filter engine without a network", () => {
  const staleFilter = "||stale-ads.example^";
  const freshFilter = "||fresh-ads.example^";
  let enabledIn: Map<ElectronBlocker, Set<unknown>>;
  let made: AdBlocker[];

  const blocks = (engine: ElectronBlocker | null, host: string): boolean =>
    engine?.match(Request.fromRawDetails({ url: `https://${host}/ad.js`, type: "script", sourceUrl: "https://music.youtube.com/" })).match ?? false;

  const activeEngine = (): ElectronBlocker | null => {
    for (const [engine, sessions] of enabledIn) if (sessions.size > 0) return engine;
    return null;
  };

  const sessionsOf = (engine: ElectronBlocker) => {
    if (!enabledIn.has(engine)) enabledIn.set(engine, new Set());
    return enabledIn.get(engine);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 0, 1));
    enabledIn = new Map();
    made = [];
    vi.spyOn(ElectronBlocker.prototype, "enableBlockingInSession").mockImplementation(function (this: ElectronBlocker, session: Session) {
      requireValue(sessionsOf(this)).add(session);
      return new BlockingContext(session, this);
    });
    vi.spyOn(ElectronBlocker.prototype, "disableBlockingInSession").mockImplementation(function (this: ElectronBlocker, session: Session) {
      requireValue(sessionsOf(this)).delete(session);
    });
    vi.spyOn(ElectronBlocker.prototype, "isBlockingEnabled").mockImplementation(function (this: ElectronBlocker, session: Session) {
      return requireValue(sessionsOf(this)).has(session);
    });
  });

  afterEach(() => {
    for (const blocker of made) blocker.disable();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const writeCache = (filter: string, ageMs: number) => {
    const dir = makeTempDir("ytmd-adblock-");
    const cachePath = path.join(dir, "adblocker-engine-network.bin");
    fs.writeFileSync(cachePath, ElectronBlocker.parse(filter, ENGINE_CONFIG).serialize());
    const when = new Date(Date.now() - ageMs);
    fs.utimesSync(cachePath, when, when);
    return cachePath;
  };

  const settle = async (blocker: AdBlocker) => {
    const loading: unknown = Reflect.get(blocker, "loading");
    if (loading instanceof Promise) await loading;
    const refreshing: unknown = Reflect.get(blocker, "refreshing");
    if (refreshing instanceof Promise) await refreshing;
  };

  const start = (cachePath: string) => {
    const blocker = new AdBlocker();
    made.push(blocker);
    callMethod(blocker, "provide", {}, cachePath);
    blocker.enable();
    return blocker;
  };

  it("keeps using a stale cache when the download fails, then swaps in fresh lists", async () => {
    const cachePath = writeCache(staleFilter, CACHE_MAX_AGE_MS + 60_000);
    const fromLists = vi.spyOn(ElectronBlocker, "fromLists").mockRejectedValue(new TypeError("fetch failed"));
    const blocker = start(cachePath);
    await settle(blocker);
    expect(activeEngine()).not.toBeNull();

    expect(fs.existsSync(cachePath)).toBe(true);
    expect(blocks(activeEngine(), "stale-ads.example")).toBe(true);

    await vi.advanceTimersByTimeAsync(ENGINE_RETRY_MS);
    await settle(blocker);
    expect(fromLists).toHaveBeenCalledTimes(2);
    expect(blocks(activeEngine(), "stale-ads.example")).toBe(true);

    fromLists.mockResolvedValue(ElectronBlocker.parse(freshFilter, ENGINE_CONFIG));
    await vi.advanceTimersByTimeAsync(ENGINE_RETRY_MS);
    await settle(blocker);
    expect(blocks(activeEngine(), "fresh-ads.example")).toBe(true);

    expect([...enabledIn.values()].filter((sessions) => sessions.size > 0)).toHaveLength(1);
    expect(blocks(ElectronBlocker.deserialize(fs.readFileSync(cachePath)), "fresh-ads.example")).toBe(true);
  });

  it("starts blocking once a later retry succeeds when there was no cache", async () => {
    const cachePath = path.join(makeTempDir("ytmd-adblock-"), "adblocker-engine-network.bin");
    const fromLists = vi.spyOn(ElectronBlocker, "fromLists").mockRejectedValue(new TypeError("fetch failed"));
    const blocker = start(cachePath);
    await settle(blocker);
    expect(fromLists).toHaveBeenCalledTimes(1);
    expect(activeEngine() === null).toBe(true);

    fromLists.mockResolvedValue(ElectronBlocker.parse(freshFilter, ENGINE_CONFIG));
    await vi.advanceTimersByTimeAsync(ENGINE_RETRY_MS);
    await settle(blocker);
    expect(blocks(activeEngine(), "fresh-ads.example")).toBe(true);
  });

  it("stops retrying once turned off", async () => {
    const cachePath = path.join(makeTempDir("ytmd-adblock-"), "adblocker-engine-network.bin");
    const fromLists = vi.spyOn(ElectronBlocker, "fromLists").mockRejectedValue(new TypeError("fetch failed"));
    const blocker = start(cachePath);
    await settle(blocker);
    expect(fromLists).toHaveBeenCalledTimes(1);
    blocker.disable();
    const attempts = fromLists.mock.calls.length;
    await vi.advanceTimersByTimeAsync(ENGINE_RETRY_MS * 3);
    await settle(blocker);

    expect(fromLists.mock.calls.length).toBe(attempts);
  });
});
