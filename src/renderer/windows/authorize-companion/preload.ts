import { contextBridge, ipcRenderer } from "electron";
import { createThemeBridge } from "../theme-bridge";
import { type WindowsEventArguments } from "~shared/types";

const requestId = process.argv[process.argv.length - 1];
const getDetails = (): Promise<{ appName: string; code: string } | null> => ipcRenderer.invoke(`companionAuthorization:details:${requestId}`);

contextBridge.exposeInMainWorld("ytmd", {
  theme: createThemeBridge(),
  sendResult: (isResult: boolean) => ipcRenderer.send(`companionAuthorization:result:${requestId}`, isResult),
  getAppName: async () => (await getDetails())?.appName ?? "",
  getCode: async () => (await getDetails())?.code ?? "",
  minimizeWindow: () => ipcRenderer.send(`companionWindow:minimize:${requestId}`),
  maximizeWindow: () => ipcRenderer.send(`companionWindow:maximize:${requestId}`),
  restoreWindow: () => ipcRenderer.send(`companionWindow:restore:${requestId}`),
  closeWindow: () => ipcRenderer.send(`companionWindow:close:${requestId}`),
  handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void) =>
    ipcRenderer.on(`companionWindow:stateChanged:${requestId}`, callback),
});
