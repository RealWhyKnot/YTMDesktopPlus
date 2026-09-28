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
    await vi.waitFor(() => expect(store["writing"]).toBe(false));
    expect(JSON.parse(fs.readFileSync(file, "utf8")).addons).toEqual({ states: {}, settings: {}, ...addons });
  });
});
