import type { WebContents } from "electron";
import type { MemoryStoreSchema, StoreSchema } from "../../shared/store/schema";
import type { IpcRegistrar } from "./registrar";
import type { SenderEvent } from "./sender-guards";
import { memoryGuards } from "~shared/store/validate-memory";

export type StoreBridgeIpcDeps = {
  store: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    set(values: Record<string, unknown>): void;
    reset(key: keyof StoreSchema): void;
  };
  memoryStore: {
    get(key: string): unknown;
    set(key: keyof MemoryStoreSchema, value: unknown): void;
    getState(): unknown;
  };
  isMemoryStoreSender(sender: WebContents): boolean;
  isSettingsSender(sender: WebContents): boolean;

  isSettingsReader(event: SenderEvent): boolean;
  decryptString(hexValue: string): string;
  encryptString(value: string): string;
};

function isSettingsKey(value: unknown): value is keyof StoreSchema {
  return (
    value === "metadata" ||
    value === "general" ||
    value === "appearance" ||
    value === "playback" ||
    value === "integrations" ||
    value === "shortcuts" ||
    value === "state" ||
    value === "lastfm" ||
    value === "developer" ||
    value === "updates" ||
    value === "addons" ||
    value === "themes"
  );
}

function isSettingEntry(value: unknown): value is [string, unknown] {
  return Array.isArray(value) && typeof value[0] === "string";
}

function isMemoryKey(value: unknown): value is keyof MemoryStoreSchema {
  return typeof value === "string" && Object.hasOwn(memoryGuards, value);
}

export function registerStoreBridgeIpc(ipc: IpcRegistrar, deps: StoreBridgeIpcDeps): void {
  ipc.on("memoryStore:set", (event, key: unknown, value?: unknown) => {
    if (!deps.isMemoryStoreSender(event.sender)) return;

    if (!isMemoryKey(key) || !memoryGuards[key](value)) return;
    deps.memoryStore.set(key, value);
  });

  ipc.handle("memoryStore:get", (event, key: unknown) => {
    if (!deps.isMemoryStoreSender(event.sender)) return;

    if (typeof key !== "string") return;
    return deps.memoryStore.get(key);
  });

  ipc.on("memoryStore:subscribe", (event) => {
    if (!deps.isMemoryStoreSender(event.sender)) return;

    event.sender.send("memoryStore:state", deps.memoryStore.getState());
  });

  ipc.on("settings:set", (event, key: unknown, value?: unknown) => {
    if (!deps.isSettingsSender(event.sender)) return;

    if (typeof key !== "string") return;
    deps.store.set(key, value);
  });

  ipc.on("settings:setMany", (event, entries: unknown) => {
    if (!deps.isSettingsSender(event.sender)) return;
    if (!Array.isArray(entries)) return;

    const changes = Object.fromEntries(entries.filter(isSettingEntry));
    if (Object.keys(changes).length > 0) deps.store.set(changes);
  });

  ipc.handle("settings:get", (event, key: unknown) => {
    if (!deps.isSettingsReader(event)) return;

    if (typeof key !== "string") return;
    return deps.store.get(key);
  });

  ipc.handle("settings:reset", (event, key: unknown) => {
    if (!deps.isSettingsSender(event.sender)) return;

    if (!isSettingsKey(key)) return;
    deps.store.reset(key);
  });

  ipc.handle("safeStorage:decryptString", (event, value: unknown) => {
    if (!deps.memoryStore.get("safeStorageAvailable")) throw new Error("safeStorage is unavailable");
    if (!deps.isSettingsSender(event.sender)) return;

    if (value) {
      if (typeof value !== "string") return;
      return deps.decryptString(value);
    } else {
      return null;
    }
  });

  ipc.handle("safeStorage:encryptString", (event, value: unknown) => {
    if (!deps.memoryStore.get("safeStorageAvailable")) throw new Error("safeStorage is unavailable");
    if (!deps.isSettingsSender(event.sender)) return;

    if (typeof value !== "string") return;
    return deps.encryptString(value);
  });
}
