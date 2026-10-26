import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAppStore } from "../src/main/store/create-store";
import { makeTempDir } from "./helpers/temp-dir";

const electronApp = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => electronApp.userData, getVersion: () => "2.0.11" }
}));

describe("createAppStore", () => {
  it.each([
    ["settings", { states: { rooms: { enabled: true } } }],
    ["states", { settings: { rooms: { autoJoin: true } } }]
  ])("backfills addons.%s when a stored addons section lacks it", async (_, addons) => {
    electronApp.userData = makeTempDir("ytmd-store-");
    const file = path.join(electronApp.userData, "config.json");
    fs.writeFileSync(file, JSON.stringify({ addons }));

    const store = createAppStore();
    store._closeWatcher();

    expect(store.get("addons")).toEqual({ states: {}, settings: {}, ...addons });
    await store.flush();
    expect(JSON.parse(fs.readFileSync(file, "utf8")).addons).toEqual({ states: {}, settings: {}, ...addons });
  });

  it("takes more than ten change listeners without a leak warning", async () => {
    electronApp.userData = makeTempDir("ytmd-store-");
    const warnings: Error[] = [];
    const onWarning = (warning: Error) => warnings.push(warning);
    process.on("warning", onWarning);
    try {
      const store = createAppStore();
      store._closeWatcher();
      const unsubscribers = Array.from({ length: 40 }, () => store.onDidChange("addons", () => undefined));
      await new Promise(resolve => setImmediate(resolve));
      unsubscribers.forEach(unsubscribe => unsubscribe());
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings.filter(warning => warning.name === "MaxListenersExceededWarning")).toEqual([]);
  });
});
