import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskRing, instrumentIpc, watchMainThreadStalls, type IpcListener, type IpcRegistrationSource } from "../src/main/stall-watch";

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
