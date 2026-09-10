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

const THEME_STYLE_ID = "ytmd-theme";

function applyAddonWindowTheme(css: string) {
  let element = document.getElementById(THEME_STYLE_ID);
  if (element === null) {
    element = document.createElement("style");
    element.id = THEME_STYLE_ID;
    document.head.insertBefore(element, document.head.firstChild);
  }
  element.textContent = css;
}

if (!process.argv.includes("--ytmd-addon-theme=0")) {
  try {
    const initial = ipcRenderer.sendSync("themes:getActiveCss") as { addonWindow: string };
    const paint = () => applyAddonWindowTheme(initial.addonWindow);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
    else paint();
    ipcRenderer.on("themes:changed", (_event, next: { addonWindow: string }) => applyAddonWindowTheme(next.addonWindow));
  } catch (error) {
    console.warn("Addon window theme could not be applied", error);
  }
}
