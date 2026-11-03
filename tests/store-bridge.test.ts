import { EventEmitter } from "node:events";
import type { IpcMainInvokeEvent } from "electron";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerStoreBridgeIpc, type StoreBridgeIpcDeps } from "../src/main/ipc/store-bridge";
import type { SenderEvent } from "../src/main/ipc/sender-guards";
import type { IpcRegistrar } from "../src/main/ipc/registrar";
import { CachedConf } from "../src/main/store/cached-conf";
import { makeTempDir } from "./helpers/temp-dir";

type Schema = { general: { startOnBoot: boolean; startMinimized: boolean }; appearance: { zoom: number } };

const stores: CachedConf<Schema>[] = [];

function bridgeDeps(overrides: Partial<StoreBridgeIpcDeps> = {}): StoreBridgeIpcDeps {
  return {
    store: { get: vi.fn<(key: string) => unknown>(), set: vi.fn(), reset: vi.fn() },
    memoryStore: { get: vi.fn<(key: string) => unknown>(), set: vi.fn(), getState: vi.fn<() => unknown>() },
    isSettingsSender: () => true,
    isMemoryStoreSender: () => false,
    isSettingsReader: () => false,
    decryptString: (value) => value,
    encryptString: (value) => value,
    ...overrides,
  };
}

function bridge() {
  const store = new CachedConf<Schema>({
    cwd: makeTempDir("ytmd-bridge-"),
    configName: "config",
    defaults: { general: { startOnBoot: false, startMinimized: false }, appearance: { zoom: 100 } },
    projectVersion: "1.0.0",
  });
  stores.push(store);
  const listeners = new EventEmitter();
  const ipc: IpcRegistrar = {
    on: (channel, listener) => {
      listeners.on(channel, listener);
    },
    handle: () => {
      return undefined;
    },
  };
  registerStoreBridgeIpc(
    ipc,
    bridgeDeps({
      store: {
        get: (key) => store.get(key),
        set(key: string | Record<string, unknown>, value?: unknown) {
          if (typeof key === "string") store.set(key, value);
          else store.set(key);
        },
        reset: vi.fn(),
      },
    })
  );
  const changes = vi.fn();
  store.events.addEventListener("change", changes);
  return { store, changes, setMany: (entries: unknown) => listeners.emit("settings:setMany", { sender: {} }, entries) };
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.flush()));
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
      ["appearance.zoom", 120],
    ]);

    expect(changes).toHaveBeenCalledOnce();
    expect(general.mock.calls).toEqual([
      [
        { startOnBoot: true, startMinimized: true },
        { startOnBoot: false, startMinimized: false },
      ],
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
  function subscriber(isAllowed: boolean) {
    const listeners = new EventEmitter();
    const ipc: IpcRegistrar = {
      on: (channel, listener) => {
        listeners.on(channel, listener);
      },
      handle: () => {
        return undefined;
      },
    };
    const state = { ytmViewLoading: true, ytmViewLoadingStatus: "Loaded" };
    registerStoreBridgeIpc(
      ipc,
      bridgeDeps({
        memoryStore: { get: vi.fn(), set: vi.fn(), getState: () => state },
        isMemoryStoreSender: () => isAllowed,
      })
    );
    const sender = { send: vi.fn() };
    listeners.emit("memoryStore:subscribe", { sender });
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
  function reader(allowed: (event: SenderEvent) => boolean) {
    const handlers = new EventEmitter();
    let result: unknown;
    const ipc: IpcRegistrar = {
      on: () => {
        return undefined;
      },
      handle: (channel, listener) => {
        handlers.on(channel, (event: IpcMainInvokeEvent, ...args: unknown[]) => {
          result = listener(event, ...args);
        });
      },
    };
    const isSettingsReader = vi.fn(allowed);
    registerStoreBridgeIpc(
      ipc,
      bridgeDeps({
        store: { get: (key: string) => `value of ${key}`, set: vi.fn(), reset: vi.fn() },
        isSettingsReader,
      })
    );
    return {
      get: (event: unknown) => {
        handlers.emit("settings:get", event, "lastfm");
        return result;
      },
      isSettingsReader,
    };
  }

  it("checks the whole event so the frame can be judged, not just the sender", () => {
    const { get, isSettingsReader } = reader(() => true);
    const event = { sender: {}, senderFrame: { url: "https://music.youtube.com/", parent: null as unknown } };

    expect(get(event)).toBe("value of lastfm");
    expect(isSettingsReader).toHaveBeenCalledWith(event);
  });

  it("returns nothing to a frame the reader check refuses", () => {
    const { get } = reader((event) => event.senderFrame?.parent === null);

    expect(get({ sender: {}, senderFrame: { url: "https://evil.example/", parent: {} } })).toBeUndefined();
  });
});
