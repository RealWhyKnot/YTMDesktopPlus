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
  await Promise.all(stores.splice(0).map(store => store.flush()));
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

describe("memoryStore:subscribe", () => {
  function subscriber(allowed: boolean) {
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
    const ipc: IpcRegistrar = {
      on: (channel, listener) => {
        listeners.set(channel, listener);
      },
      handle: () => {}
    };
    const state = { ytmViewLoading: true, ytmViewLoadingStatus: "Loaded" };
    registerStoreBridgeIpc(ipc, {
      memoryStore: { getState: () => state },
      isMemoryStoreSender: () => allowed
    } as unknown as StoreBridgeIpcDeps);
    const sender = { send: vi.fn() };
    listeners.get("memoryStore:subscribe")({ sender });
    return { sender, state };
  }

  it("answers a known window with the whole memory state", () => {
    const { sender, state } = subscriber(true);

    expect(sender.send).toHaveBeenCalledWith("memoryStore:state", state);
  });

  it("ignores a sender that may not read the memory store", () => {
    expect(subscriber(false).sender.send).not.toHaveBeenCalled();
  });
});

describe("settings:get", () => {
  function reader(allowed: (event: unknown) => boolean) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipc: IpcRegistrar = {
      on: () => {},
      handle: (channel, listener) => {
        handlers.set(channel, listener);
      }
    };
    const isSettingsReader = vi.fn(allowed);
    registerStoreBridgeIpc(ipc, {
      store: { get: (key: string) => `value of ${key}` },
      isSettingsReader
    } as unknown as StoreBridgeIpcDeps);
    return { get: (event: unknown) => handlers.get("settings:get")(event, "lastfm"), isSettingsReader };
  }

  it("checks the whole event so the frame can be judged, not just the sender", () => {
    const { get, isSettingsReader } = reader(() => true);
    const event = { sender: {}, senderFrame: { url: "https://music.youtube.com/", parent: null as unknown } };

    expect(get(event)).toBe("value of lastfm");
    expect(isSettingsReader).toHaveBeenCalledWith(event);
  });

  it("returns nothing to a frame the reader check refuses", () => {
    const { get } = reader(event => (event as { senderFrame: { parent: unknown } }).senderFrame.parent === null);

    expect(get({ sender: {}, senderFrame: { url: "https://evil.example/", parent: {} } })).toBeUndefined();
  });
});
