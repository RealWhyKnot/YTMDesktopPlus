import { invokeValue } from "../../ipc-values";
import { arrayOf, isString, isBoolean, isUndefined, nullable } from "~shared/validation";
import { isAddonDescriptor } from "~shared/addons/validate-descriptor";
import { isThemeDescriptor, isThemeActionResult } from "~shared/themes/validate-descriptor";
import { memoryGuards } from "~shared/store/validate-memory";
import { storeGuards } from "~shared/store/validate-settings";
import { contextBridge, ipcRenderer, webUtils } from "electron";
import { createThemeBridge } from "../theme-bridge";
import { Store } from "../../store-ipc/store";
import { type MemoryStoreSchema, type StoreSchema } from "~shared/store/schema";
import { type WindowsEventArguments } from "~shared/types";
import { MemoryStore } from "../../store-ipc/memory-store";

const store = new Store<StoreSchema>(storeGuards);
const memoryStore = new MemoryStore<MemoryStoreSchema>(memoryGuards);

contextBridge.exposeInMainWorld("ytmd", {
  theme: createThemeBridge(),
  isDarwin: process.platform === "darwin",
  isLinux: process.platform === "linux",
  isWindows: process.platform === "win32",
  memoryStore: {
    set: (key: string, value: unknown) => memoryStore.set(key, value),
    get: async (key: keyof MemoryStoreSchema) => await memoryStore.get(key),
    onStateChanged: (callback: (newState: Partial<MemoryStoreSchema>, oldState: Partial<MemoryStoreSchema>) => void) => memoryStore.onStateChanged(callback),
  },
  store: {
    set: (key: string, value: unknown) => store.set(key, value),
    setMany: (entries: [string, unknown][]) => store.setMany(entries),
    get: async (key: keyof StoreSchema) => await store.get(key),
    reset: (key: keyof StoreSchema) => store.reset(key),
    onDidAnyChange: (callback: (newState: StoreSchema, oldState: StoreSchema) => void) => store.onDidAnyChange(callback),
  },
  safeStorage: {
    decryptString: async (value: string) => await invokeValue("safeStorage:decryptString", nullable(isString), value),
    encryptString: async (value: string) => await invokeValue("safeStorage:encryptString", isString, value),
  },
  addons: {
    getAll: async () => await invokeValue("addons:getAll", arrayOf(isAddonDescriptor)),
    setEnabled: async (id: string, isEnabled: boolean) => await invokeValue("addons:setEnabled", isUndefined, id, isEnabled),
    openFolder: () => ipcRenderer.send("addons:openFolder"),
    invokeAction: (id: string, key: string) => ipcRenderer.send("addons:invokeAction", id, key),
    openHomepage: (id: string) => ipcRenderer.send("addons:openHomepage", id),
    getRecentLog: async (id: string) => await invokeValue("addons:getRecentLog", arrayOf(isString), id),
  },
  themes: {
    getAll: async () => await invokeValue("themes:getAll", arrayOf(isThemeDescriptor)),
    rescan: async () => await invokeValue("themes:rescan", arrayOf(isThemeDescriptor)),
    setActive: async (id: string | null) => await invokeValue("themes:setActive", isThemeActionResult, id),
    create: async () => await invokeValue("themes:create", isThemeActionResult),
    duplicate: async (id: string) => await invokeValue("themes:duplicate", isThemeActionResult, id),
    exportTheme: async (id: string) => await invokeValue("themes:export", isThemeActionResult, id),
    installFromFile: async () => await invokeValue("themes:installFromFile", isThemeActionResult),
    openFolder: () => ipcRenderer.send("themes:openFolder"),
  },
  restartApplication: () => ipcRenderer.send("settingsWindow:restartapplication"),
  openRoomWindow: () => ipcRenderer.send("addon:rooms:openWindow"),
  restartApplicationForUpdate: () => ipcRenderer.send("app:restartApplicationForUpdate"),
  minimizeWindow: () => ipcRenderer.send("settingsWindow:minimize"),
  maximizeWindow: () => ipcRenderer.send("settingsWindow:maximize"),
  restoreWindow: () => ipcRenderer.send("settingsWindow:restore"),
  closeWindow: () => ipcRenderer.send("settingsWindow:close"),
  handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void) =>
    ipcRenderer.on("settingsWindow:stateChanged", callback),
  getAppVersion: async (): Promise<string> => await invokeValue("app:getVersion", isString),
  checkForUpdates: () => ipcRenderer.send("app:checkForUpdates"),
  handleCheckingForUpdate: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:checkingForUpdates", callback),
  handleUpdateAvailable: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:updateAvailable", callback),
  handleUpdateNotAvailable: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:updateNotAvailable", callback),
  handleUpdateDownloaded: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:updateDownloaded", callback),
  isAppUpdateAvailable: async (): Promise<boolean> => await invokeValue("app:isUpdateAvailable", isBoolean),
  isAppUpdateDownloaded: async (): Promise<boolean> => await invokeValue("app:isUpdateDownloaded", isBoolean),
  getTrueFilePath: (file: File) => webUtils.getPathForFile(file),
});
