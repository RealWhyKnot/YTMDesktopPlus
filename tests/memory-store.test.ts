import { describe, expect, it } from "vitest";
import MemoryStore from "../src/main/memory-store";

describe("MemoryStore", () => {
  it("reports only the changed key and value, without copying the state", () => {
    const store = new MemoryStore<Record<string, unknown>>();
    const changes: [string, unknown][] = [];
    store.onStateChanged((key, value) => changes.push([key, value]));

    const runtime = { themes: ["a", "b"] };
    store.set("themesRuntime", runtime);
    store.set("ytmViewLoadingStatus", "Loaded");

    expect(changes).toEqual([
      ["themesRuntime", runtime],
      ["ytmViewLoadingStatus", "Loaded"]
    ]);
    expect(changes[0][1]).toBe(runtime);
  });

  it("hands out the full state for a window that subscribes late", () => {
    const store = new MemoryStore<Record<string, unknown>>();
    store.set("safeStorageAvailable", true);
    store.set("ytmViewLoading", false);
    store.set("ytmViewLoading", true);

    expect(store.getState()).toEqual({ safeStorageAvailable: true, ytmViewLoading: true });
  });

  it("stops reporting to a removed listener", () => {
    const store = new MemoryStore<Record<string, unknown>>();
    const keys: string[] = [];
    const listener = (key: string) => keys.push(key);
    store.onStateChanged(listener);
    store.set("a", 1);
    store.removeOnStateChanged(listener);
    store.set("b", 2);

    expect(keys).toEqual(["a"]);
  });
});
