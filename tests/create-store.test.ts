import { requireRecord } from "./helpers/require-value";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAppStore } from "../src/main/store/create-store";
import { storeGuards } from "../src/shared/store/validate-settings";
import { makeTempDir } from "./helpers/temp-dir";

const electronApp = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => electronApp.userData, getVersion: () => "2.0.11" },
}));

describe("createAppStore", () => {
  it.each([
    ["settings", { states: { rooms: { enabled: true } } }],
    ["states", { settings: { rooms: { autoJoin: true } } }],
  ])("backfills addons.%s when a stored addons section lacks it", async (_, addons) => {
    electronApp.userData = makeTempDir("ytmd-store-");
    const file = path.join(electronApp.userData, "config.json");
    fs.writeFileSync(file, JSON.stringify({ addons }));

    const store = createAppStore();
    store._closeWatcher();

    expect(store.get("addons")).toEqual({ states: {}, settings: {}, ...addons });
    await store.flush();
    expect(requireRecord(JSON.parse(fs.readFileSync(file, "utf8"))).addons).toEqual({ states: {}, settings: {}, ...addons });
  });

  it("repairs a profile saved by an older build so every section passes its guard", async () => {
    electronApp.userData = makeTempDir("ytmd-store-");
    const file = path.join(electronApp.userData, "config.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        appearance: { alwaysShowVolumeSlider: true, zoom: "120", trayIconStyle: 0 },
        integrations: { companionServerEnabled: true, discordPresenceEnabled: true },
      })
    );

    const store = createAppStore();
    store._closeWatcher();

    expect(store.get("appearance.zoom")).toBe(120);
    expect(store.get("appearance.alwaysShowVolumeSlider")).toBe(true);
    expect(store.get("integrations.companionServerLANEnabled")).toBe(true);
    expect(store.get("integrations.listenAlongHostPort")).toBe(9863);
    expect(store.get("integrations.listenAlongHost")).toBeNull();
    expect(
      Object.entries(storeGuards)
        .filter(([section, guard]) => !guard(store.get(section)))
        .map(([section]) => section)
    ).toEqual([]);
    await store.flush();
    const saved = requireRecord(JSON.parse(fs.readFileSync(file, "utf8")));
    expect(requireRecord(saved.appearance).zoom).toBe(120);
    expect(requireRecord(saved.integrations).listenAlongHostPort).toBe(9863);
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
      await new Promise<void>((resolve) => process.nextTick(resolve));
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    } finally {
      process.off("warning", onWarning);
    }
    expect(warnings.filter((warning) => warning.name === "MaxListenersExceededWarning")).toEqual([]);
  });
});
