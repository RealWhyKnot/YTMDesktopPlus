import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coalesce } from "../src/main/windows/coalesce";

describe("coalesce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs once per burst, with the size the window had last", () => {
    let width = 800;
    const applied: number[] = [];
    const onResize = coalesce(() => applied.push(width));

    for (const next of [810, 820, 830]) {
      width = next;
      onResize();
    }
    expect(applied).toEqual([]);

    vi.runAllTimers();
    expect(applied).toEqual([830]);
  });

  it("keeps following a resize that is still going", () => {
    let width = 800;
    const applied: number[] = [];
    const onResize = coalesce(() => applied.push(width));

    width = 900;
    onResize();
    vi.runAllTimers();
    width = 1000;
    onResize();
    onResize();
    vi.runAllTimers();

    expect(applied).toEqual([900, 1000]);
  });
});
