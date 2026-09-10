import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ElectronBlocker, Request } from "@ghostery/adblocker-electron";
import type { RequestType } from "@ghostery/adblocker-electron";
import { CACHE_MAX_AGE_MS, ENGINE_CONFIG, isCacheStale, LEGACY_CACHE_FILES } from "../src/main/integrations/ad-blocker/cache";
import { installAdPrune } from "../src/renderer/ytmview/ad-prune";
import { AD_PRUNE_CONTRACT } from "../src/shared/ad-contract";
import AdBlocker from "../src/main/integrations/ad-blocker";
import type { BrowserView } from "electron";

const NOW = 1_770_000_000_000;

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
    // A machine whose clock jumped back would otherwise sit on the same lists
    // until the date caught up.
    expect(isCacheStale(NOW + 60_000, NOW)).toBe(true);
  });
});

describe("LEGACY_CACHE_FILES", () => {
  // A serialized engine carries the options it was built with, so reading one of
  // these back would quietly restore cosmetic filtering.
  it("names the cosmetic-era engine so it gets deleted rather than read", () => {
    expect(LEGACY_CACHE_FILES).toContain("adblocker-engine.bin");
  });

  it("does not name the file the app writes now", () => {
    expect(LEGACY_CACHE_FILES).not.toContain("adblocker-engine-network.bin");
  });
});

describe("installAdPrune", () => {
  const nativeParse = JSON.parse;
  let events: Array<[string, unknown]>;
  let misses: string[];

  // The measured shape of a real break on music.youtube.com: the ad arrives in
  // adSlots while adPlacements is empty, so a fixture that only carries
  // adPlacements would pass against a prune that cannot work.
  const playerResponse = (): Record<string, unknown> => ({
    playabilityStatus: { status: "OK" },
    streamingData: { formats: [{ itag: 251 }] },
    adPlacements: [],
    adSlots: [
      { slotType: "SLOT_TYPE_PLAYER_BYTES", slotRenderer: { playerBytesAdLayoutRenderer: {} } },
      { slotType: "SLOT_TYPE_IN_PLAYER", slotRenderer: { inPlayerAdLayoutRenderer: {} } },
      { slotType: "SLOT_TYPE_IN_PLAYER", slotRenderer: { inPlayerAdLayoutRenderer: {} } }
    ],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }],
    videoDetails: { videoId: "dQw4w9WgXcQ" }
  });

  beforeEach(() => {
    events = [];
    misses = [];
    (globalThis as { window?: unknown }).window = {
      ytmd: {
        sendAdBlockEvent: (kind: string, detail: unknown) => events.push([kind, detail]),
        reportContractMiss: (what: string) => misses.push(what)
      }
    };
  });

  afterEach(() => {
    JSON.parse = nativeParse;
    delete (globalThis as { window?: unknown }).window;
  });

  it("takes the ad keys out of a player response", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const parsed = JSON.parse(JSON.stringify(playerResponse()));

    expect(parsed).not.toHaveProperty("adSlots");
    expect(parsed).not.toHaveProperty("playerAds");
    expect(parsed).not.toHaveProperty("adPlacements");
    expect(parsed.videoDetails).toEqual({ videoId: "dQw4w9WgXcQ" });
    expect(parsed.streamingData).toEqual({ formats: [{ itag: 251 }] });
  });

  it("takes them out of a nested playerResponse too", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const parsed = JSON.parse(JSON.stringify({ playerResponse: playerResponse() }));

    expect(parsed.playerResponse).not.toHaveProperty("adSlots");
    expect(parsed.playerResponse.videoDetails).toEqual({ videoId: "dQw4w9WgXcQ" });
  });

  it("leaves a payload with no ad keys exactly as it was", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const payload = { contents: { rows: [1, 2, 3] }, header: null as null };

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect((globalThis as unknown as { window: { __ytmdAdPrune: { count: number } } }).window.__ytmdAdPrune.count).toBe(0);
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

    const parsed = JSON.parse('{"a":1,"b":2}', (key, value) => (typeof value === "number" ? value * 10 : value));

    expect(parsed).toEqual({ a: 10, b: 20 });
  });

  it("hands back the payload untouched rather than half pruned when a delete throws", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const frozen = Object.freeze({ adPlacements: [], adSlots: [{}] });
    const parsed = JSON.parse("{}", () => frozen);

    expect(parsed).toBe(frozen);
    expect(parsed).toHaveProperty("adSlots");
  });

  it("reports the first prune of the page load and no others", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    JSON.parse(JSON.stringify(playerResponse()));
    JSON.parse(JSON.stringify(playerResponse()));

    expect(events).toEqual([["pruned", ["adPlacements", "adSlots", "playerAds"]]]);
    expect((globalThis as unknown as { window: { __ytmdAdPrune: { count: number } } }).window.__ytmdAdPrune.count).toBe(2);
  });

  it("does not wrap JSON.parse twice", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);
    const wrapped = JSON.parse;
    installAdPrune(true, AD_PRUNE_CONTRACT);

    expect(JSON.parse).toBe(wrapped);
  });

  it("prunes the root and one playerResponse below it, no deeper", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    const parsed = JSON.parse(JSON.stringify({ response: { playerResponse: playerResponse() }, playerResponse: { playerResponse: playerResponse() } }));

    expect(parsed.response.playerResponse).toHaveProperty("adSlots");
    expect(parsed.playerResponse.playerResponse).toHaveProperty("adSlots");
  });

  it("lets a parse error through rather than swallowing it", () => {
    installAdPrune(true, AD_PRUNE_CONTRACT);

    expect(() => JSON.parse("{not json")).toThrow();
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
  let events: Array<[string, unknown]>;

  const pruneState = (): { count: number; unknown: string[] } =>
    (globalThis as unknown as { window: { __ytmdAdPrune: { count: number; unknown: string[] } } }).window.__ytmdAdPrune;

  const known = (): Record<string, unknown> => ({
    adPlacements: [],
    adSlots: [{ slotType: "SLOT_TYPE_PLAYER_BYTES" }],
    playerAds: [{ playerLegacyDesktopWatchAdsRenderer: {} }]
  });

  const response = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    playabilityStatus: { status: "OK" },
    streamingData: { formats: [{ itag: 251 }], adaptiveFormats: [{ itag: 140 }] },
    videoDetails: { videoId: "dQw4w9WgXcQ" },
    ...extra
  });

  beforeEach(() => {
    misses = [];
    events = [];
    (globalThis as { window?: unknown }).window = {
      ytmd: {
        sendAdBlockEvent: (kind: string, detail: unknown) => events.push([kind, detail]),
        reportContractMiss: (what: string) => misses.push(what)
      }
    };
  });

  afterEach(() => {
    JSON.parse = nativeParse;
    delete (globalThis as { window?: unknown }).window;
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
    (globalThis as unknown as { window: { ytmd: { reportContractMiss: () => void } } }).window.ytmd.reportContractMiss = () => {
      throw new Error("ipc unavailable");
    };

    installAdPrune(true, AD_PRUNE_CONTRACT);

    const parsed = JSON.parse(JSON.stringify(response({ ...known(), adBreaks: [{}] })));

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
    const sends: Array<unknown[]> = [];
    const view = { webContents: { send: (...args: unknown[]) => sends.push(args), isDestroyed: () => false } } as unknown as BrowserView;
    return { blocker: new AdBlocker(), view, sends };
  };

  it("waits for the view before injecting", () => {
    const { blocker, view, sends } = build();

    blocker.enable();
    blocker.provideView(view);

    expect(sends).toEqual([]);

    blocker.ytmViewLoaded();

    expect(sends).toEqual([["ytmView:executeScript", "adBlock", "enable"]]);
  });

  it("injects again for the next document the view loads", () => {
    // Signing in navigates the view away and back, which leaves a fresh main
    // world with nothing in it.
    const { blocker, view, sends } = build();

    blocker.enable();
    blocker.provideView(view);
    blocker.ytmViewLoaded();
    blocker.ytmViewLoaded();

    expect(sends).toHaveLength(2);
  });

  it("tears the page script down when the setting goes off", () => {
    const { blocker, view, sends } = build();

    blocker.enable();
    blocker.provideView(view);
    blocker.ytmViewLoaded();
    blocker.disable();

    expect(sends[1]).toEqual(["ytmView:executeScript", "adBlock", "disable"]);
  });

  it("injects nothing while the setting is off", () => {
    const { blocker, view, sends } = build();

    blocker.provideView(view);
    blocker.ytmViewLoaded();
    blocker.disable();

    expect(sends).toEqual([]);
  });

  it("stays quiet when the window took the view down with it", () => {
    // A destroyed window leaves webContents undefined rather than destroyed,
    // and reading through it is what crashed the app on every native close.
    const { blocker, view } = build();

    blocker.enable();
    blocker.provideView(view);
    blocker.ytmViewLoaded();
    (view as unknown as { webContents: unknown }).webContents = undefined;

    expect(() => blocker.disable()).not.toThrow();
  });

  it("stays quiet when the view is destroyed", () => {
    const { blocker, view, sends } = build();

    blocker.provideView(view);
    blocker.ytmViewLoaded();
    (view.webContents as unknown as { isDestroyed: () => boolean }).isDestroyed = () => true;
    blocker.enable();

    expect(sends).toEqual([]);
  });

  it("serves both scripts to the page", () => {
    expect(new AdBlocker().getYTMScripts().map(entry => entry.name)).toEqual(["enable", "disable"]);
  });
});
