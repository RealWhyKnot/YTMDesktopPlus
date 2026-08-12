import type Conf from "conf";
import type { WebContents } from "electron";
import type MemoryStore from "../memory-store";
import type { MemoryStoreSchema, StoreSchema } from "../../shared/store/schema";
import type { IpcRegistrar } from "./registrar";

export interface StoreBridgeIpcDeps {
  store: Conf<StoreSchema>;
  memoryStore: MemoryStore<MemoryStoreSchema>;
  isMemoryStoreSender(sender: WebContents): boolean;
  isSettingsSender(sender: WebContents): boolean;
  // Widest read set: main window, settings window, ytm view, addon windows.
  isSettingsReader(sender: WebContents): boolean;
  decryptString(hexValue: string): string;
  encryptString(value: string): string;
}

export function registerStoreBridgeIpc(ipc: IpcRegistrar, deps: StoreBridgeIpcDeps): void {
  // Handle memory store ipc
  ipc.on("memoryStore:set", (event, key: string, value?: unknown) => {
    if (!deps.isMemoryStoreSender(event.sender)) return;

    deps.memoryStore.set(key, value);
  });

  ipc.handle("memoryStore:get", (event, key: string) => {
    if (!deps.isMemoryStoreSender(event.sender)) return;

    return deps.memoryStore.get(key);
  });

  // Handle settings store ipc
  ipc.on("settings:set", (event, key: string, value?: unknown) => {
    if (!deps.isSettingsSender(event.sender)) return;

    deps.store.set(key, value);
  });

  ipc.on("settings:setMany", (event, entries: Array<[string, unknown]>) => {
    if (!deps.isSettingsSender(event.sender)) return;
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      deps.store.set(entry[0], entry[1]);
    }
  });

  ipc.handle("settings:get", (event, key: string) => {
    if (!deps.isSettingsReader(event.sender)) return;

    return deps.store.get(key);
  });

  ipc.handle("settings:reset", (event, key: keyof StoreSchema) => {
    if (!deps.isSettingsSender(event.sender)) return;

    deps.store.reset(key);
  });

  // Handle safeStorage ipc
  ipc.handle("safeStorage:decryptString", (event, value: string) => {
    if (!deps.memoryStore.get("safeStorageAvailable")) throw new Error("safeStorage is unavailable");
    if (!deps.isSettingsSender(event.sender)) return;

    if (value) {
      return deps.decryptString(value);
    } else {
      return null;
    }
  });

  ipc.handle("safeStorage:encryptString", (event, value: string) => {
    if (!deps.memoryStore.get("safeStorageAvailable")) throw new Error("safeStorage is unavailable");
    if (!deps.isSettingsSender(event.sender)) return;

    return deps.encryptString(value);
  });
}
