import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAppStore } from "../src/main/store/create-store";
import { makeTempDir } from "./helpers/temp-dir";

const electronApp = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => electronApp.userData, getVersion: () => "2.0.11" }
}));

function openStore(stored?: Record<string, unknown>) {
  electronApp.userData = makeTempDir("ytmd-store-");
  if (stored) fs.writeFileSync(path.join(electronApp.userData, "config.json"), JSON.stringify(stored));
  const store = createAppStore();
  store._closeWatcher();
  return store;
}

describe("companion server LAN access setting", () => {
  it("defaults to off on a new install", () => {
    expect(openStore().get("integrations").companionServerLANEnabled).toBe(false);
  });

  it("turns on for an existing install that already runs the companion server", () => {
    const store = openStore({ integrations: { companionServerEnabled: true, companionServerCORSWildcardEnabled: false } });
    expect(store.get("integrations").companionServerLANEnabled).toBe(true);
  });

  it("stays off for an existing install without the companion server", () => {
    const store = openStore({ integrations: { companionServerEnabled: false } });
    expect(store.get("integrations").companionServerLANEnabled).toBe(false);
  });

  it("keeps a value the user already chose", () => {
    const store = openStore({ integrations: { companionServerEnabled: true, companionServerLANEnabled: false } });
    expect(store.get("integrations").companionServerLANEnabled).toBe(false);
  });
});
