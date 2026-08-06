import { describe, expect, it } from "vitest";
import { CACHE_MAX_AGE_MS, isCacheStale } from "../src/main/integrations/ad-blocker/cache";

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
