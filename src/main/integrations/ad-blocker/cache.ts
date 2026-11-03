export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const LEGACY_CACHE_FILES = ["adblocker-engine.bin"];

export const ENGINE_CONFIG = { enableCompression: true, loadCosmeticFilters: false };

export function isCacheStale(mtimeMs: number, now: number): boolean {
  const age = now - mtimeMs;

  return age < 0 || age > CACHE_MAX_AGE_MS;
}
