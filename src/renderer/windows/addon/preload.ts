import { memoryGuards } from "~shared/store/validate-memory";
import { contextBridge, ipcRenderer } from "electron";
import type { AddonWindowBridge } from "~shared/addons/sdk";
import type { MemoryStoreSchema } from "~shared/store/schema";
import { MemoryStore } from "../../store-ipc/memory-store";
import { invokeUnknown, invokeValue } from "../../ipc-values";
import { storeGuards } from "~shared/store/validate-settings";
import { optional } from "~shared/validation";
import { isRecord } from "~shared/unknown";
import { createThemeBridge } from "../theme-bridge";
import reducedMotionCss from "../../../assets/reduced-motion.css?raw";

const addonId = (process.argv.find((argument) => argument.startsWith("--ytmd-addon-id=")) ?? "").slice("--ytmd-addon-id=".length);
const prefixed = (channel: string) => `addon:${addonId}:${channel}`;
const memoryStore = new MemoryStore<MemoryStoreSchema>(memoryGuards);

const bridge: AddonWindowBridge = {
  addonId,
  invoke: (channel, ...args) => invokeUnknown(prefixed(channel), ...args),
  send: (channel, ...args) => ipcRenderer.send(prefixed(channel), ...args),
  on: (channel, listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(prefixed(channel), wrapped);
    return () => ipcRenderer.removeListener(prefixed(channel), wrapped);
  },
  settings: {
    getAll: async () => {
      const addons = await invokeValue("settings:get", optional(storeGuards.addons), "addons");
      return addons?.settings[addonId] ?? {};
    },
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, newState: unknown) => {
        const addons = isRecord(newState) && storeGuards.addons(newState.addons) ? newState.addons : undefined;
        callback(addons?.settings[addonId] ?? {});
      };
      ipcRenderer.on("settings:stateChanged", listener);
      return () => ipcRenderer.removeListener("settings:stateChanged", listener);
    },
  },
  memory: {
    getAll: async () => {
      const all = await memoryStore.get("addonMemory");
      return all?.[addonId] ?? {};
    },
    onChanged: (callback) => memoryStore.onStateChanged((newState) => callback(newState.addonMemory?.[addonId] ?? {})),
  },
  closeWindow: () => ipcRenderer.send(prefixed("window:close")),
};

contextBridge.exposeInMainWorld("ytmdAddon", bridge);

const THEME_STYLE_ID = "ytmd-theme";

function applyReducedMotion() {
  const element = document.createElement("style");
  element.textContent = reducedMotionCss;
  document.head.appendChild(element);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyReducedMotion, { once: true });
else applyReducedMotion();

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
    const themes = createThemeBridge();
    const initial = themes.getCss();
    const paint = () => applyAddonWindowTheme(initial.addonWindow);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
    else paint();
    themes.onChanged((next) => applyAddonWindowTheme(next.addonWindow));
  } catch (error) {
    console.warn("Addon window theme could not be applied", error);
  }
}
