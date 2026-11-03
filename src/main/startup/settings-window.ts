import path from "path";

import { createAppWindow, loadWindowEntry } from "../windows/window-factory";

import type { MainContext } from "../index";

export function showSettingsWindow(context: MainContext): void {
  if (context.mainWindow === null) {
    return;
  }

  if (context.settingsWindow !== null) {
    context.settingsWindow.focus();
    return;
  }

  const mainWindowBounds = context.mainWindow.getBounds();

  context.settingsWindow = createAppWindow({
    width: 800,
    height: 600,
    minWidth: 560,
    minHeight: 420,
    x: Math.round(mainWindowBounds.x + (mainWindowBounds.width / 2 - 400)),
    y: Math.round(mainWindowBounds.y + (mainWindowBounds.height / 2 - 300)),
    minimizable: false,
    maximizable: false,
    resizable: true,
    show: false,
    icon: context.getIconPath("ytmd.png"),
    parent: context.mainWindow,
    modal: !context.isDarwin,
    openExternalUrls: ["https://github.com/RealWhyKnot/YTMDesktopPlus"],
    webPreferences: {
      preload: path.join(__dirname, `../renderer/windows/settings/preload.js`),
      devTools: context.store.get("developer").enableDevTools,
    },
  });

  context.settingsWindow.on("maximize", context.sendSettingsWindowStateIpc);
  context.settingsWindow.on("unmaximize", context.sendSettingsWindowStateIpc);
  context.settingsWindow.on("minimize", context.sendSettingsWindowStateIpc);
  context.settingsWindow.on("restore", context.sendSettingsWindowStateIpc);

  context.settingsWindow.webContents.on("will-prevent-unload", () => {
    context.isApplicationQuitting = false;
  });

  context.settingsWindow.once("closed", () => {
    context.settingsWindow = null;
  });

  context.settingsWindow.on("ready-to-show", () => {
    context.requireSettingsWindow().show();

    if (process.env.NODE_ENV === "development") {
      context.requireSettingsWindow().webContents.openDevTools({
        mode: "detach",
      });
    }
  });

  loadWindowEntry(context.settingsWindow, "settings", context.allWindowsViteDevServerUrl);
}
