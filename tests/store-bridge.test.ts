import { afterEach, describe, expect, it, vi } from "vitest";
import { registerStoreBridgeIpc, type StoreBridgeIpcDeps } from "../src/main/ipc/store-bridge";
import type { IpcRegistrar } from "../src/main/ipc/registrar";
import { CachedConf } from "../src/main/store/cached-conf";
import { makeTempDir } from "./helpers/temp-dir";

type Schema = { general: { startOnBoot: boolean; startMinimized: boolean }; appearance: { zoom: number } };

const stores: CachedConf<Schema>[] = [];

function bridge() {
  const store = new CachedConf<Schema>({
    cwd: makeTempDir("ytmd-bridge-"),
    configName: "config",
    defaults: { general: { startOnBoot: false, startMinimized: false }, appearance: { zoom: 100 } },
    projectVersion: "1.0.0"
  });
  stores.push(store);
  const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
  const ipc: IpcRegistrar = {
    on: (channel, listener) => {
      listeners.set(channel, listener);
    },
    handle: () => {}
  };
  registerStoreBridgeIpc(ipc, { store, isSettingsSender: () => true } as unknown as StoreBridgeIpcDeps);
  const changes = vi.fn();
  store.events.addEventListener("change", changes);
  return { store, changes, setMany: (entries: unknown) => listeners.get("settings:setMany")({ sender: {} }, entries) };
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map(store => vi.waitFor(() => expect(store["writing"]).toBe(false))));
});

describe("settings:setMany", () => {
  it("saves a batch with one config write and tells each key listener once", () => {
    const { store, changes, setMany } = bridge();
    const general = vi.fn();
    const appearance = vi.fn();
    store.onDidChange("general", general);
    store.onDidChange("appearance", appearance);

    setMany([
      ["general.startOnBoot", true],
      ["general.startMinimized", true],
      ["appearance.zoom", 120]
    ]);

    expect(changes).toHaveBeenCalledOnce();
    expect(general.mock.calls).toEqual([
      [
        { startOnBoot: true, startMinimized: true },
        { startOnBoot: false, startMinimized: false }
      ]
    ]);
    expect(appearance.mock.calls).toEqual([[{ zoom: 120 }, { zoom: 100 }]]);
  });

  it("skips malformed entries and writes nothing when none are left", () => {
    const { store, changes, setMany } = bridge();

    setMany([["general.startOnBoot", true], "junk", [42, "x"]]);
    setMany(["junk"]);

    expect(store.get("general").startOnBoot).toBe(true);
    expect(changes).toHaveBeenCalledOnce();
  });
});
