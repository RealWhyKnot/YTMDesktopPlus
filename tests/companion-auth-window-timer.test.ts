import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MemoryStore from "../src/main/memory-store";
import { AUTH_WINDOW_DURATION_MS, watchCompanionAuthWindow } from "../src/main/integrations/companion-server/auth-window-timer";
import type { MemoryStoreSchema } from "../src/shared/store/schema";

describe("watchCompanionAuthWindow", () => {
  let memoryStore: MemoryStore<MemoryStoreSchema>;
  let serverEnabled: boolean;
  let stop: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    memoryStore = new MemoryStore<MemoryStoreSchema>();
    serverEnabled = true;
    stop = watchCompanionAuthWindow(memoryStore, () => serverEnabled);
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it("turns pairing off five minutes after a memory store write turns it on", () => {
    memoryStore.set("companionServerAuthWindowEnabled", true);

    vi.advanceTimersByTime(AUTH_WINDOW_DURATION_MS - 1);
    expect(memoryStore.get("companionServerAuthWindowEnabled")).toBe(true);

    vi.advanceTimersByTime(1);
    expect(memoryStore.get("companionServerAuthWindowEnabled")).toBe(false);
  });

  it("starts a fresh five minutes after pairing is turned off and on again", () => {
    memoryStore.set("companionServerAuthWindowEnabled", true);
    vi.advanceTimersByTime(AUTH_WINDOW_DURATION_MS - 1000);
    memoryStore.set("companionServerAuthWindowEnabled", false);
    memoryStore.set("companionServerAuthWindowEnabled", true);

    vi.advanceTimersByTime(AUTH_WINDOW_DURATION_MS - 1);
    expect(memoryStore.get("companionServerAuthWindowEnabled")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(memoryStore.get("companionServerAuthWindowEnabled")).toBe(false);
  });

  it("does not reset the timer when pairing is turned on twice", () => {
    memoryStore.set("companionServerAuthWindowEnabled", true);
    vi.advanceTimersByTime(AUTH_WINDOW_DURATION_MS - 1000);
    memoryStore.set("companionServerAuthWindowEnabled", true);

    vi.advanceTimersByTime(1000);
    expect(memoryStore.get("companionServerAuthWindowEnabled")).toBe(false);
  });

  it("refuses to turn pairing on while the server is off", () => {
    serverEnabled = false;
    memoryStore.set("companionServerAuthWindowEnabled", true);

    expect(memoryStore.get("companionServerAuthWindowEnabled")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignores other memory store keys", () => {
    memoryStore.set("safeStorageAvailable", true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
