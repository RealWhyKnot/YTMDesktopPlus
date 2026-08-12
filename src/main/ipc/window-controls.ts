import type { BrowserWindow, WebContents } from "electron";
import type { IpcRegistrar } from "./registrar";

export interface WindowControlIpcDeps {
  getMainWindow(): BrowserWindow | null;
  getSettingsWindow(): BrowserWindow | null;
  isMainWindowSender(sender: WebContents): boolean;
  isSettingsSender(sender: WebContents): boolean;
  // store.get("general").hideToTrayOnClose || isDarwin at close time
  hideMainWindowOnClose(): boolean;
  quitApp(): void;
  relaunchApp(): void;
  sendMainWindowState(): void;
  openSettingsWindow(): void;
}

export function registerWindowControlIpc(ipc: IpcRegistrar, deps: WindowControlIpcDeps): void {
  // Handle main window ipc
  ipc.on("mainWindow:minimize", event => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow !== null) {
      if (!deps.isMainWindowSender(event.sender)) return;

      mainWindow.minimize();
    }
  });

  ipc.on("mainWindow:maximize", event => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow !== null) {
      if (!deps.isMainWindowSender(event.sender)) return;

      mainWindow.maximize();
    }
  });

  ipc.on("mainWindow:restore", event => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow !== null) {
      if (!deps.isMainWindowSender(event.sender)) return;

      mainWindow.restore();
    }
  });

  ipc.on("mainWindow:close", event => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow !== null) {
      if (!deps.isMainWindowSender(event.sender)) return;

      if (deps.hideMainWindowOnClose()) {
        mainWindow.hide();
      } else {
        deps.quitApp();
      }
    }
  });

  ipc.on("mainWindow:requestWindowState", event => {
    if (!deps.isMainWindowSender(event.sender)) return;

    deps.sendMainWindowState();
  });

  // Handle settings window ipc
  ipc.on("settingsWindow:open", event => {
    if (!deps.isMainWindowSender(event.sender)) return;

    deps.openSettingsWindow();
  });

  ipc.on("settingsWindow:minimize", event => {
    const settingsWindow = deps.getSettingsWindow();
    if (settingsWindow !== null) {
      if (!deps.isSettingsSender(event.sender)) return;

      settingsWindow.minimize();
    }
  });

  ipc.on("settingsWindow:maximize", event => {
    const settingsWindow = deps.getSettingsWindow();
    if (settingsWindow !== null) {
      if (!deps.isSettingsSender(event.sender)) return;

      settingsWindow.maximize();
    }
  });

  ipc.on("settingsWindow:restore", event => {
    const settingsWindow = deps.getSettingsWindow();
    if (settingsWindow !== null) {
      if (!deps.isSettingsSender(event.sender)) return;

      settingsWindow.restore();
    }
  });

  ipc.on("settingsWindow:close", event => {
    const settingsWindow = deps.getSettingsWindow();
    if (settingsWindow !== null) {
      if (!deps.isSettingsSender(event.sender)) return;

      settingsWindow.close();
    }
  });

  ipc.on("settingsWindow:restartapplication", event => {
    if (!deps.isSettingsSender(event.sender)) return;

    deps.relaunchApp();
  });
}
