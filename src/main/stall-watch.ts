export type StallWatchOptions = {
  intervalMs?: number;
  thresholdMs?: number;
  now?: () => number;
  tasks?: TaskOverlapSource;
  report(blockedMs: number, summary: string): void;
};

export type LabelledTask = { label: string; start: number; duration: number };

export type TaskOverlapSource = {
  overlapping(windowStart: number, windowEnd: number): LabelledTask[];
};

export type TimeSync = <T>(label: string, fn: () => T) => T;

export type TaskRing = TaskOverlapSource & {
  record(label: string, start: number, duration: number): void;
  timeSync: TimeSync;
};

export type IpcListener = (...args: unknown[]) => unknown;

export type IpcRegistrationSource = {
  emit(channel: string | symbol, ...args: unknown[]): boolean;
  handle(channel: string, listener: IpcListener): unknown;
  handleOnce(channel: string, listener: IpcListener): unknown;
};

const SLEEP_GAP_MS = 60_000;
const MIN_RECORDED_DURATION_MS = 16;
const MAX_REPORTED_TASKS = 5;
const NO_LABELLED_WORK = "no labelled work";

export function createTaskRing(capacity: number, now: () => number = () => performance.now()): TaskRing {
  const tasks: LabelledTask[] = [];
  let next = 0;

  function record(label: string, start: number, duration: number): void {
    if (duration < MIN_RECORDED_DURATION_MS) return;
    if (tasks.length < capacity) {
      tasks.push({ label, start, duration });
    } else {
      tasks[next] = { label, start, duration };
      next = (next + 1) % capacity;
    }
  }

  function overlapping(windowStart: number, windowEnd: number): LabelledTask[] {
    return tasks.filter(task => task.start < windowEnd && task.start + task.duration > windowStart);
  }

  function timeSync<T>(label: string, fn: () => T): T {
    const start = now();
    try {
      return fn();
    } finally {
      record(label, start, now() - start);
    }
  }

  return { record, overlapping, timeSync };
}

export const stallTasks = createTaskRing(128);

export function instrumentIpc(target: IpcRegistrationSource, timeSync: TimeSync): void {
  const emit = target.emit.bind(target);
  target.emit = (channel, ...args) => timeSync(`ipc ${String(channel)}`, () => emit(channel, ...args));

  const wrap = (original: (channel: string, listener: IpcListener) => unknown) => (channel: string, listener: IpcListener) =>
    original(channel, (...args: unknown[]) => timeSync(`ipc ${channel}`, () => listener(...args)));

  target.handle = wrap(target.handle.bind(target));
  target.handleOnce = wrap(target.handleOnce.bind(target));
}

function summarize(tasks: LabelledTask[]): string {
  if (tasks.length === 0) return NO_LABELLED_WORK;
  return tasks
    .slice()
    .sort((a, b) => b.duration - a.duration)
    .slice(0, MAX_REPORTED_TASKS)
    .map(task => `${task.label} ${Math.round(task.duration)}ms`)
    .join(", ");
}

export function watchMainThreadStalls(options: StallWatchOptions): () => void {
  const intervalMs = options.intervalMs ?? 250;
  const thresholdMs = options.thresholdMs ?? 300;
  const now = options.now ?? (() => performance.now());
  const tasks = options.tasks ?? { overlapping: () => [] };
  let last = now();
  const timer = setInterval(() => {
    const current = now();
    const windowStart = last;
    const late = current - last - intervalMs;
    last = current;
    if (late >= thresholdMs && late < SLEEP_GAP_MS) {
      options.report(Math.round(late), summarize(tasks.overlapping(windowStart, current)));
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
