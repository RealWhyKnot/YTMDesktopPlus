import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTaskRing,
  instrumentIpc,
  markSystemEvents,
  markWindowMessages,
  watchMainThreadStalls,
  type IpcListener,
  type IpcRegistrationSource
} from "../src/main/stall-watch";

function stepClock(values: number[]): () => number {
  let index = 0;
  return () => values[index++];
}

describe("watchMainThreadStalls", () => {
  let clock = 0;
  const tick = (lateBy = 0) => {
    clock += 250 + lateBy;
    vi.advanceTimersByTime(250);
  };

  beforeEach(() => {
    clock = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports a tick that arrives late past the threshold, and nothing for normal jitter", () => {
    const reports: number[] = [];
    const stop = watchMainThreadStalls({ now: () => clock, report: ms => reports.push(ms) });

    tick(12);
    tick(299);
    tick(812);
    tick(0);
    stop();

    expect(reports).toEqual([812]);
  });

  it("ignores the gap left by the machine sleeping", () => {
    const reports: number[] = [];
    const stop = watchMainThreadStalls({ now: () => clock, report: ms => reports.push(ms) });

    tick(3_600_000);
    stop();

    expect(reports).toEqual([]);
  });

  it("stops reporting once stopped", () => {
    const reports: number[] = [];
    const stop = watchMainThreadStalls({ now: () => clock, report: ms => reports.push(ms) });

    stop();
    tick(1000);

    expect(reports).toEqual([]);
  });

  it("reports no labelled work when nothing overlaps the stall window", () => {
    const reports: string[] = [];
    const stop = watchMainThreadStalls({ now: () => clock, tasks: { overlapping: () => [] }, report: (_ms, summary) => reports.push(summary) });

    tick(400);
    stop();

    expect(reports).toEqual(["no labelled work"]);
  });

  it("appends the overlapping tasks to the report, longest first and capped at five", () => {
    const reports: string[] = [];
    const overlapping = () => [
      { label: "a", start: 0, duration: 10 },
      { label: "b", start: 0, duration: 90 },
      { label: "c", start: 0, duration: 50 },
      { label: "d", start: 0, duration: 40 },
      { label: "e", start: 0, duration: 30 },
      { label: "f", start: 0, duration: 20 }
    ];
    const stop = watchMainThreadStalls({ now: () => clock, tasks: { overlapping }, report: (_ms, summary) => reports.push(summary) });

    tick(400);
    stop();

    expect(reports).toEqual(["b 90ms, c 50ms, d 40ms, e 30ms, f 20ms"]);
  });

  it("asks for tasks only in the gap since the previous tick", () => {
    const seen: [number, number][] = [];
    const stop = watchMainThreadStalls({
      now: () => clock,
      tasks: {
        overlapping: (start, end) => {
          seen.push([start, end]);
          return [];
        }
      },
      report: () => undefined
    });

    tick(400);
    stop();

    expect(seen).toEqual([[0, 650]]);
  });

  it("names the system events behind every stall of a monitor-removal burst", () => {
    const reports: string[] = [];
    const ring = createTaskRing(10, () => clock);
    const stop = watchMainThreadStalls({ now: () => clock, tasks: ring, report: (ms, summary) => reports.push(`${ms} ${summary}`) });

    tick(0);
    ring.mark("display change");
    ring.mark("display metrics changed");
    ring.mark("display metrics changed");
    tick(1161);
    tick(1044);
    ring.mark("display removed");
    tick(7213);
    stop();

    expect(reports).toEqual([
      "1161 no labelled work; system: display change, display metrics changed x2",
      "1044 no labelled work; system: display change, display metrics changed x2",
      "7213 no labelled work; system: display change, display metrics changed x2, display removed"
    ]);
  });

  it("keeps labelled work first when a system event is also near", () => {
    const reports: string[] = [];
    const tasks = { overlapping: () => [{ label: "conf write", start: 0, duration: 380 }], marksNear: () => ["resume"] };
    const stop = watchMainThreadStalls({ now: () => clock, tasks, report: (_ms, summary) => reports.push(summary) });

    tick(400);
    stop();

    expect(reports).toEqual(["conf write 380ms; system: resume"]);
  });
});

describe("createTaskRing", () => {
  it("returns the value a timed function produces", () => {
    const ring = createTaskRing(10, stepClock([0, 20]));

    expect(ring.timeSync("work", () => 42)).toBe(42);
  });

  it("lets a thrown error propagate and still records the task", () => {
    const ring = createTaskRing(10, stepClock([0, 20]));

    expect(() =>
      ring.timeSync("failing", () => {
        throw new Error("boom");
      })
    ).toThrow("boom");
    expect(ring.overlapping(0, 20)).toEqual([{ label: "failing", start: 0, duration: 20 }]);
  });

  it("does not record a call shorter than the 16ms floor", () => {
    const ring = createTaskRing(10, stepClock([0, 15]));

    ring.timeSync("quick", (): void => undefined);

    expect(ring.overlapping(0, 15)).toEqual([]);
  });

  it("includes a task whose span overlaps the window and excludes one entirely outside it", () => {
    const ring = createTaskRing(10, stepClock([0, 20, 100, 120]));

    ring.timeSync("inside", (): void => undefined);
    ring.timeSync("outside", (): void => undefined);

    expect(ring.overlapping(10, 30).map(task => task.label)).toEqual(["inside"]);
  });

  it("keeps only the most recent tasks once the ring is full", () => {
    const values: number[] = [];
    for (let i = 0; i < 3; i++) values.push(i * 100, i * 100 + 20);
    const ring = createTaskRing(2, stepClock(values));

    ring.timeSync("a", (): void => undefined);
    ring.timeSync("b", (): void => undefined);
    ring.timeSync("c", (): void => undefined);

    expect(
      ring
        .overlapping(0, 1000)
        .map(task => task.label)
        .sort()
    ).toEqual(["b", "c"]);
  });
});

describe("system event marks", () => {
  it("returns marks from 15s before the window up to its end", () => {
    let clock = 0;
    const ring = createTaskRing(10, () => clock);

    for (const [at, label] of [
      [1_000, "too old"],
      [6_000, "lookback edge"],
      [20_000, "inside"],
      [21_001, "after"]
    ] as const) {
      clock = at;
      ring.mark(label);
    }

    expect(ring.marksNear(21_000, 21_000)).toEqual(["lookback edge", "inside"]);
  });

  it("keeps only the newest 64 marks", () => {
    let clock = 0;
    const ring = createTaskRing(10, () => clock);

    for (let i = 0; i < 70; i++) {
      clock = i;
      ring.mark(`m${i}`);
    }

    const marks = ring.marksNear(0, 100);
    expect(marks).toHaveLength(64);
    expect(marks[0]).toBe("m6");
  });

  it("marks and logs display and power events", () => {
    const screen = new EventEmitter();
    const powerMonitor = new EventEmitter();
    const marked: string[] = [];
    const logged: string[] = [];

    markSystemEvents({ screen, powerMonitor }, { mark: label => marked.push(label) }, label => logged.push(label));
    screen.emit("display-removed", {}, { id: 1 });
    screen.emit("display-metrics-changed", {}, { id: 2 }, ["workArea"]);
    powerMonitor.emit("resume");
    powerMonitor.emit("lock-screen");

    expect(marked).toEqual(["display removed", "display metrics changed", "resume", "screen locked"]);
    expect(logged).toEqual(marked);
  });

  it("marks WM_DISPLAYCHANGE and the device-tree WM_DEVICECHANGE, ignoring other device notifications", () => {
    const hooks = new Map<number, (wParam: Buffer, lParam: Buffer) => void>();
    const marked: string[] = [];
    const wParam = (value: number) => {
      const buffer = Buffer.alloc(8);
      buffer.writeUInt32LE(value, 0);
      return buffer;
    };

    markWindowMessages({ hookWindowMessage: (message, callback) => hooks.set(message, callback) }, { mark: label => marked.push(label) });
    hooks.get(0x007e)(wParam(32), Buffer.alloc(8));
    hooks.get(0x0219)(wParam(0x8000), Buffer.alloc(8));
    hooks.get(0x0219)(wParam(0x0007), Buffer.alloc(8));

    expect(marked).toEqual(["display change", "device change"]);
  });
});

describe("instrumentIpc", () => {
  function fakeTarget() {
    const listeners: Record<string, IpcListener> = {};
    const target: IpcRegistrationSource & EventEmitter = Object.assign(new EventEmitter(), {
      handle: (channel: string, listener: IpcListener) => {
        listeners[`handle:${channel}`] = listener;
      },
      handleOnce: (channel: string, listener: IpcListener) => {
        listeners[`handleOnce:${channel}`] = listener;
      }
    });
    return { target, listeners };
  }

  it("times the synchronous part of a handle listener and passes its return value through", () => {
    const ring = createTaskRing(10, stepClock([0, 25]));
    const { target, listeners } = fakeTarget();

    instrumentIpc(target, ring.timeSync);
    target.handle("settings:setMany", () => "ok");
    const result = listeners["handle:settings:setMany"]();

    expect(result).toBe("ok");
    expect(ring.overlapping(0, 25)).toEqual([{ label: "ipc settings:setMany", start: 0, duration: 25 }]);
  });

  it("times the listeners an emitted channel runs", () => {
    const ring = createTaskRing(10, stepClock([0, 30]));
    const { target } = fakeTarget();

    instrumentIpc(target, ring.timeSync);
    target.once("ytmView:getPlaylists:response:1", () => undefined);
    target.emit("ytmView:getPlaylists:response:1");

    expect(ring.overlapping(0, 30).map(task => task.label)).toEqual(["ipc ytmView:getPlaylists:response:1"]);
  });

  it("still removes an on listener by the reference it was added with", () => {
    const { target } = fakeTarget();
    let calls = 0;
    const listener = () => calls++;

    instrumentIpc(target, createTaskRing(10).timeSync);
    target.on("companionWindow:close:1", listener);
    target.removeListener("companionWindow:close:1", listener);
    target.emit("companionWindow:close:1");

    expect(calls).toBe(0);
  });
});
