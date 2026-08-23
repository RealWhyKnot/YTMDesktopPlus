import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CACHE_MAX_AGE_MS, isCacheStale, LEGACY_CACHE_FILES } from "../src/main/integrations/ad-blocker/cache";
import { installAdPrune } from "../src/renderer/ytmview/ad-prune";
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
    (globalThis as { window?: unknown }).window = {
      ytmd: { sendAdBlockEvent: (kind: string, detail: unknown) => events.push([kind, detail]) }
    };
  });

  afterEach(() => {
    JSON.parse = nativeParse;
    delete (globalThis as { window?: unknown }).window;
  });

  it("takes the ad keys out of a player response", () => {
    installAdPrune(true);

    const parsed = JSON.parse(JSON.stringify(playerResponse()));

    expect(parsed).not.toHaveProperty("adSlots");
    expect(parsed).not.toHaveProperty("playerAds");
    expect(parsed).not.toHaveProperty("adPlacements");
    expect(parsed.videoDetails).toEqual({ videoId: "dQw4w9WgXcQ" });
    expect(parsed.streamingData).toEqual({ formats: [{ itag: 251 }] });
  });

  it("takes them out of a nested playerResponse too", () => {
    installAdPrune(true);

    const parsed = JSON.parse(JSON.stringify({ playerResponse: playerResponse() }));

    expect(parsed.playerResponse).not.toHaveProperty("adSlots");
    expect(parsed.playerResponse.videoDetails).toEqual({ videoId: "dQw4w9WgXcQ" });
  });

  it("leaves a payload with no ad keys exactly as it was", () => {
    installAdPrune(true);

    const payload = { contents: { rows: [1, 2, 3] }, header: null as null };

    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
    expect((globalThis as unknown as { window: { __ytmdAdPrune: { count: number } } }).window.__ytmdAdPrune.count).toBe(0);
  });

  it("prunes nothing while the setting is off", () => {
    installAdPrune(false);

    expect(JSON.parse(JSON.stringify(playerResponse()))).toHaveProperty("adSlots");
  });

  it("prunes again once the setting is flipped back on", () => {
    installAdPrune(false);
    installAdPrune(true);

    expect(JSON.parse(JSON.stringify(playerResponse()))).not.toHaveProperty("adSlots");
  });

  it("keeps the reviver working", () => {
    installAdPrune(true);

    const parsed = JSON.parse('{"a":1,"b":2}', (key, value) => (typeof value === "number" ? value * 10 : value));

    expect(parsed).toEqual({ a: 10, b: 20 });
  });

  it("hands back the payload untouched rather than half pruned when a delete throws", () => {
    installAdPrune(true);

    const frozen = Object.freeze({ adPlacements: [], adSlots: [{}] });
    const parsed = JSON.parse("{}", () => frozen);

    expect(parsed).toBe(frozen);
    expect(parsed).toHaveProperty("adSlots");
  });

  it("reports the first prune of the page load and no others", () => {
    installAdPrune(true);

    JSON.parse(JSON.stringify(playerResponse()));
    JSON.parse(JSON.stringify(playerResponse()));

    expect(events).toEqual([["pruned", ["adSlots", "playerAds", "adPlacements"]]]);
    expect((globalThis as unknown as { window: { __ytmdAdPrune: { count: number } } }).window.__ytmdAdPrune.count).toBe(2);
  });

  it("does not wrap JSON.parse twice", () => {
    installAdPrune(true);
    const wrapped = JSON.parse;
    installAdPrune(true);

    expect(JSON.parse).toBe(wrapped);
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
