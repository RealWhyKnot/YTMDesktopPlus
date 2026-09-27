import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchMainThreadStalls } from "../src/main/stall-watch";

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
});
