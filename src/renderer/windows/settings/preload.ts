// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, webUtils } from "electron";
import Store from "../../store-ipc/store";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { WindowsEventArguments } from "~shared/types";
import MemoryStore from "../../store-ipc/memory-store";

const store = new Store<StoreSchema>();
const memoryStore = new MemoryStore<MemoryStoreSchema>();

contextBridge.exposeInMainWorld("ytmd", {
  isDarwin: process.platform === "darwin",
  isLinux: process.platform === "linux",
  isWindows: process.platform === "win32",
  memoryStore: {
    set: (key: string, value: unknown) => memoryStore.set(key, value),
    get: async (key: keyof MemoryStoreSchema) => await memoryStore.get(key),
    onStateChanged: (callback: (newState: MemoryStoreSchema, oldState: MemoryStoreSchema) => void) => memoryStore.onStateChanged(callback)
  },
  store: {
    set: (key: string, value: unknown) => store.set(key, value),
    setMany: (entries: Array<[string, unknown]>) => store.setMany(entries),
    get: async (key: keyof StoreSchema) => await store.get(key),
    reset: (key: keyof StoreSchema) => store.reset(key),
    onDidAnyChange: (callback: (newState: StoreSchema, oldState: StoreSchema) => void) => store.onDidAnyChange(callback)
  },
  safeStorage: {
    decryptString: async (value: string) => await ipcRenderer.invoke("safeStorage:decryptString", value),
    encryptString: async (value: string) => await ipcRenderer.invoke("safeStorage:encryptString", value)
  },
  addons: {
    getAll: async () => await ipcRenderer.invoke("addons:getAll"),
    setEnabled: async (id: string, enabled: boolean) => await ipcRenderer.invoke("addons:setEnabled", id, enabled),
    openFolder: () => ipcRenderer.send("addons:openFolder"),
    invokeAction: (id: string, key: string) => ipcRenderer.send("addons:invokeAction", id, key)
  },
  restartApplication: () => ipcRenderer.send("settingsWindow:restartapplication"),
  openRoomWindow: () => ipcRenderer.send("room:openWindow"),
  restartApplicationForUpdate: () => ipcRenderer.send("app:restartApplicationForUpdate"),
  minimizeWindow: () => ipcRenderer.send("settingsWindow:minimize"),
  maximizeWindow: () => ipcRenderer.send("settingsWindow:maximize"),
  restoreWindow: () => ipcRenderer.send("settingsWindow:restore"),
  closeWindow: () => ipcRenderer.send("settingsWindow:close"),
  handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void) =>
    ipcRenderer.on("settingsWindow:stateChanged", callback),
  getAppVersion: async (): Promise<string> => await ipcRenderer.invoke("app:getVersion"),
  checkForUpdates: () => ipcRenderer.send("app:checkForUpdates"),
  handleCheckingForUpdate: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:checkingForUpdates", callback),
  handleUpdateAvailable: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:updateAvailable", callback),
  handleUpdateNotAvailable: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:updateNotAvailable", callback),
  handleUpdateDownloaded: (callback: (event: Electron.IpcRendererEvent) => void) => ipcRenderer.on("app:updateDownloaded", callback),
  isAppUpdateAvailable: async (): Promise<boolean> => await ipcRenderer.invoke("app:isUpdateAvailable"),
  isAppUpdateDownloaded: async (): Promise<boolean> => await ipcRenderer.invoke("app:isUpdateDownloaded"),
  getTrueFilePath: (file: File) => webUtils.getPathForFile(file)
});
