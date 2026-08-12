import { describe, expect, it } from "vitest";
import { CACHE_MAX_AGE_MS, isCacheStale, LEGACY_CACHE_FILES } from "../src/main/integrations/ad-blocker/cache";

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
