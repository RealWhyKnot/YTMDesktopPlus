export type StallWatchOptions = {
  intervalMs?: number;
  thresholdMs?: number;
  now?: () => number;
  report(blockedMs: number): void;
};

const SLEEP_GAP_MS = 60_000;

export function watchMainThreadStalls(options: StallWatchOptions): () => void {
  const intervalMs = options.intervalMs ?? 250;
  const thresholdMs = options.thresholdMs ?? 300;
  const now = options.now ?? (() => performance.now());
  let last = now();
  const timer = setInterval(() => {
    const current = now();
    const late = current - last - intervalMs;
    last = current;
    if (late >= thresholdMs && late < SLEEP_GAP_MS) options.report(Math.round(late));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
