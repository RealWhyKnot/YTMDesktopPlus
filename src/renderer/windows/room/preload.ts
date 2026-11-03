import { memoryGuards } from "~shared/store/validate-memory";
import { storeGuards } from "~shared/store/validate-settings";
import { contextBridge, ipcRenderer } from "electron";
import { createThemeBridge } from "../theme-bridge";
import { Store } from "../../store-ipc/store";
import { MemoryStore } from "../../store-ipc/memory-store";
import { type MemoryStoreSchema, type StoreSchema } from "~shared/store/schema";

const store = new Store<StoreSchema>(storeGuards);
const memoryStore = new MemoryStore<MemoryStoreSchema>(memoryGuards);

contextBridge.exposeInMainWorld("ytmd", {
  theme: createThemeBridge(),
  isDarwin: process.platform === "darwin",
  isLinux: process.platform === "linux",
  isWindows: process.platform === "win32",
  memoryStore: {
    get: async (key: keyof MemoryStoreSchema) => await memoryStore.get(key),
    onStateChanged: (callback: (newState: Partial<MemoryStoreSchema>, oldState: Partial<MemoryStoreSchema>) => void) => memoryStore.onStateChanged(callback),
  },
  store: {
    get: async (key: keyof StoreSchema) => await store.get(key),
  },
  roomHost: (displayName: string) => ipcRenderer.send("addon:rooms:host", displayName),
  roomJoin: (roomId: string, displayName: string) => ipcRenderer.send("addon:rooms:join", roomId, displayName),
  roomLeave: () => ipcRenderer.send("addon:rooms:leave"),
  roomDismissJoinPrompt: () => ipcRenderer.send("addon:rooms:dismissJoinPrompt"),
  roomGrant: (memberId: string, role: number) => ipcRenderer.send("addon:rooms:grant", memberId, role),
  roomControl: (action: string, value?: unknown) => ipcRenderer.send("addon:rooms:control", action, value),
  roomResume: () => ipcRenderer.send("addon:rooms:resume"),
  minimizeWindow: () => {
    return undefined;
  },
  maximizeWindow: () => {
    return undefined;
  },
  restoreWindow: () => {
    return undefined;
  },
  closeWindow: () => ipcRenderer.send("addon:rooms:closeWindow"),
  handleWindowEvents: () => {
    return undefined;
  },
});
