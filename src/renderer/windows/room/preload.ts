import { contextBridge, ipcRenderer } from "electron";
import Store from "../../store-ipc/store";
import MemoryStore from "../../store-ipc/memory-store";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";

const store = new Store<StoreSchema>();
const memoryStore = new MemoryStore<MemoryStoreSchema>();

contextBridge.exposeInMainWorld("ytmd", {
  isDarwin: process.platform === "darwin",
  isLinux: process.platform === "linux",
  isWindows: process.platform === "win32",
  memoryStore: {
    get: async (key: keyof MemoryStoreSchema) => await memoryStore.get(key),
    onStateChanged: (callback: (newState: MemoryStoreSchema, oldState: MemoryStoreSchema) => void) => memoryStore.onStateChanged(callback)
  },
  store: {
    get: async (key: keyof StoreSchema) => await store.get(key)
  },
  roomHost: (displayName: string) => ipcRenderer.send("addon:rooms:host", displayName),
  roomJoin: (roomId: string, displayName: string) => ipcRenderer.send("addon:rooms:join", roomId, displayName),
  roomLeave: () => ipcRenderer.send("addon:rooms:leave"),
  roomGrant: (memberId: string, role: number) => ipcRenderer.send("addon:rooms:grant", memberId, role),
  roomControl: (action: string, value?: unknown) => ipcRenderer.send("addon:rooms:control", action, value),
  roomResume: () => ipcRenderer.send("addon:rooms:resume"),
  minimizeWindow: () => {},
  maximizeWindow: () => {},
  restoreWindow: () => {},
  closeWindow: () => ipcRenderer.send("addon:rooms:closeWindow"),
  handleWindowEvents: () => {}
});
