export const VOLUME_STEP = 10;

export function steppedVolume(current: number, delta: number): number | null {
  const next = current + delta;
  if (!Number.isFinite(next)) return null;
  return Math.min(100, Math.max(0, next));
}
