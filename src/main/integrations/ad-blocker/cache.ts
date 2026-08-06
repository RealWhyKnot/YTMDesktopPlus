// Compiling the filter lists means fetching a dozen files and parsing them, so
// the result is serialized next to the config. Ghostery invalidates the cache
// itself when the engine format changes, but never when the list contents go
// stale, so the age check is ours to make.
export const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isCacheStale(mtimeMs: number, now: number): boolean {
  const age = now - mtimeMs;
  // A cache stamped in the future means the clock moved; treat it as unusable
  // rather than trusting it until the date catches up.
  return age < 0 || age > CACHE_MAX_AGE_MS;
}
