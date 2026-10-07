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
  marksNear?(windowStart: number, windowEnd: number): string[];
};

export type TimeSync = <T>(label: string, fn: () => T) => T;

export type TaskRing = TaskOverlapSource & {
  record(label: string, start: number, duration: number): void;
  mark(label: string): void;
  marksNear(windowStart: number, windowEnd: number): string[];
  timeSync: TimeSync;
};

export type IpcListener = (...args: unknown[]) => unknown;

export type IpcRegistrationSource = {
  emit(channel: string | symbol, ...args: unknown[]): boolean;
  handle(channel: string, listener: IpcListener): unknown;
  handleOnce(channel: string, listener: IpcListener): unknown;
};

export type EventSource = {
  on(event: string, listener: () => void): unknown;
};

export type WindowMessageSource = {
  hookWindowMessage(message: number, callback: (wParam: Buffer, lParam: Buffer) => void): void;
};

const SLEEP_GAP_MS = 60_000;
const MIN_RECORDED_DURATION_MS = 16;
const MAX_REPORTED_TASKS = 5;
const NO_LABELLED_WORK = "no labelled work";
const MARK_LOOKBACK_MS = 15_000;
const MAX_MARKS = 64;

const WM_DISPLAYCHANGE = 0x007e;
const WM_DEVICECHANGE = 0x0219;
const DBT_DEVNODES_CHANGED = 0x0007;

const SYSTEM_EVENTS: [source: "screen" | "powerMonitor", event: string, label: string][] = [
  ["screen", "display-added", "display added"],
  ["screen", "display-removed", "display removed"],
  ["screen", "display-metrics-changed", "display metrics changed"],
  ["powerMonitor", "suspend", "suspend"],
  ["powerMonitor", "resume", "resume"],
  ["powerMonitor", "lock-screen", "screen locked"],
  ["powerMonitor", "unlock-screen", "screen unlocked"]
];

export function createTaskRing(capacity: number, now: () => number = () => performance.now()): TaskRing {
  const tasks: LabelledTask[] = [];
  const marks: { label: string; at: number }[] = [];
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

  function mark(label: string): void {
    marks.push({ label, at: now() });
    if (marks.length > MAX_MARKS) marks.shift();
  }

  function marksNear(windowStart: number, windowEnd: number): string[] {
    return marks.filter(entry => entry.at >= windowStart - MARK_LOOKBACK_MS && entry.at <= windowEnd).map(entry => entry.label);
  }

  function timeSync<T>(label: string, fn: () => T): T {
    const start = now();
    try {
      return fn();
    } finally {
      record(label, start, now() - start);
    }
  }

  return { record, overlapping, mark, marksNear, timeSync };
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

export function markSystemEvents(sources: Record<"screen" | "powerMonitor", EventSource>, ring: Pick<TaskRing, "mark">, log: (label: string) => void): void {
  for (const [source, event, label] of SYSTEM_EVENTS) {
    sources[source].on(event, () => {
      ring.mark(label);
      log(label);
    });
  }
}

export function markWindowMessages(window: WindowMessageSource, ring: Pick<TaskRing, "mark">): void {
  window.hookWindowMessage(WM_DISPLAYCHANGE, () => ring.mark("display change"));
  window.hookWindowMessage(WM_DEVICECHANGE, wParam => {
    if (wParam.readUInt32LE(0) === DBT_DEVNODES_CHANGED) ring.mark("device change");
  });
}

function summarizeWork(tasks: LabelledTask[]): string {
  if (tasks.length === 0) return NO_LABELLED_WORK;
  return tasks
    .slice()
    .sort((a, b) => b.duration - a.duration)
    .slice(0, MAX_REPORTED_TASKS)
    .map(task => `${task.label} ${Math.round(task.duration)}ms`)
    .join(", ");
}

function summarize(tasks: LabelledTask[], marks: string[]): string {
  const work = summarizeWork(tasks);
  if (marks.length === 0) return work;
  const counts = new Map<string, number>();
  for (const label of marks) counts.set(label, (counts.get(label) ?? 0) + 1);
  const system = [...counts].map(([label, count]) => (count > 1 ? `${label} x${count}` : label)).join(", ");
  return `${work}; system: ${system}`;
}

export function watchMainThreadStalls(options: StallWatchOptions): () => void {
  const intervalMs = options.intervalMs ?? 250;
  const thresholdMs = options.thresholdMs ?? 300;
  const now = options.now ?? (() => performance.now());
  const tasks: TaskOverlapSource = options.tasks ?? { overlapping: () => [] };
  let last = now();
  const timer = setInterval(() => {
    const current = now();
    const windowStart = last;
    const late = current - last - intervalMs;
    last = current;
    if (late >= thresholdMs && late < SLEEP_GAP_MS) {
      options.report(Math.round(late), summarize(tasks.overlapping(windowStart, current), tasks.marksNear?.(windowStart, current) ?? []));
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
