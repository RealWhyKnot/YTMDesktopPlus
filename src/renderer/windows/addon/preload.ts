import { contextBridge, ipcRenderer } from "electron";
import type { AddonWindowBridge } from "~shared/addons/sdk";
import type { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";

// The one preload every addon-shipped window gets. It only reaches channels
// already open to addon windows, namespaced to the owning addon.

const addonId = (process.argv.find(argument => argument.startsWith("--ytmd-addon-id=")) ?? "").slice("--ytmd-addon-id=".length);
const prefixed = (channel: string) => `addon:${addonId}:${channel}`;

const bridge: AddonWindowBridge = {
  addonId,
  invoke: (channel, ...args) => ipcRenderer.invoke(prefixed(channel), ...args),
  send: (channel, ...args) => ipcRenderer.send(prefixed(channel), ...args),
  on: (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(prefixed(channel), wrapped);
    return () => ipcRenderer.removeListener(prefixed(channel), wrapped);
  },
  settings: {
    getAll: async () => {
      const addons = (await ipcRenderer.invoke("settings:get", "addons")) as StoreSchema["addons"] | undefined;
      return addons?.settings?.[addonId] ?? {};
    },
    onChanged: callback => {
      const listener = (_event: Electron.IpcRendererEvent, newState: StoreSchema) => {
        callback(newState?.addons?.settings?.[addonId] ?? {});
      };
      ipcRenderer.on("settings:stateChanged", listener);
      return () => ipcRenderer.removeListener("settings:stateChanged", listener);
    }
  },
  memory: {
    getAll: async () => {
      const all = (await ipcRenderer.invoke("memoryStore:get", "addonMemory")) as MemoryStoreSchema["addonMemory"] | undefined;
      return all?.[addonId] ?? {};
    },
    onChanged: callback => {
      const listener = (_event: Electron.IpcRendererEvent, newState: MemoryStoreSchema) => {
        callback(newState?.addonMemory?.[addonId] ?? {});
      };
      ipcRenderer.on("memoryStore:stateChanged", listener);
      return () => ipcRenderer.removeListener("memoryStore:stateChanged", listener);
    }
  },
  closeWindow: () => ipcRenderer.send(prefixed("window:close"))
};

contextBridge.exposeInMainWorld("ytmdAddon", bridge);
