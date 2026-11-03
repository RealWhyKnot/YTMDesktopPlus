import { installYtmViewLifecycle } from "../windows/ytm-view-lifecycle";
import { app, screen } from "electron";
import log from "electron-log";
import path from "path";

import { markWindowMessages, stallTasks } from "../stall-watch";

import { createAppWindow, loadWindowEntry } from "../windows/window-factory";

import { coalesce } from "../windows/coalesce";
import { applyLaunchVisibility, startsHidden } from "../windows/launch-visibility";

import type { MainContext } from "../index";

export function openMainWindow(context: MainContext): void {
  const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
  const windowBounds = context.store.get("state").windowBounds;
  context.mainWindow = createAppWindow({
    width: windowBounds?.width ?? 1280 / scaleFactor,
    height: windowBounds?.height ?? 720 / scaleFactor,
    x: windowBounds?.x,
    y: windowBounds?.y,
    minWidth: 156,
    minHeight: 180,
    show: false,
    icon: context.getIconPath("ytmd.png"),
    webPreferences: {
      preload: path.join(__dirname, `../renderer/windows/main/preload.js`),
      devTools: context.store.get("developer").enableDevTools,
    },
  });
  installYtmViewLifecycle(context.mainWindow);
  if (process.platform === "win32") markWindowMessages(context.mainWindow, stallTasks);
  const isWindowMaximized = context.store.get("state").windowMaximized;

  if (windowBounds) {
    context.mainWindow.setBounds(windowBounds);
  }
  applyLaunchVisibility(context.mainWindow, { hidden: startsHidden(context.store.get("general"), process.platform), maximized: isWindowMaximized });

  context.mainWindow.on(
    "resize",
    coalesce(() => {
      if (context.ytmView) {
        if (context.requireMainWindow().fullScreen) {
          context.ytmView.setBounds({
            x: 0,
            y: 0,
            width: context.requireMainWindow().getContentBounds().width,
            height: context.requireMainWindow().getContentBounds().height,
          });
        } else {
          context.ytmView.setBounds({
            x: 0,
            y: 36,
            width: context.requireMainWindow().getContentBounds().width,
            height: context.requireMainWindow().getContentBounds().height - 36,
          });
        }
      }
    })
  );

  context.mainWindow.on("enter-full-screen", () => {
    setTimeout(() => {
      if (context.ytmView) {
        context.ytmView.setBounds({
          x: 0,
          y: 0,
          width: context.requireMainWindow().getContentBounds().width,
          height: context.requireMainWindow().getContentBounds().height,
        });
      }
    });
    context.sendMainWindowStateIpc();
  });
  context.mainWindow.on("leave-full-screen", () => {
    setTimeout(() => {
      context.requireYtmView().setBounds({
        x: 0,
        y: 36,
        width: context.requireMainWindow().getContentBounds().width,
        height: context.requireMainWindow().getContentBounds().height - 36,
      });
    });
    context.sendMainWindowStateIpc();
  });
  context.mainWindow.on("maximize", context.sendMainWindowStateIpc);
  context.mainWindow.on("unmaximize", context.sendMainWindowStateIpc);
  context.mainWindow.on("minimize", context.sendMainWindowStateIpc);
  context.mainWindow.on("restore", context.sendMainWindowStateIpc);
  context.mainWindow.on("close", (event) => {
    if (!context.isApplicationQuitting && (context.store.get("general").hideToTrayOnClose || context.isDarwin)) {
      event.preventDefault();
      context.requireMainWindow().hide();
    }

    context.store.set("state", {
      ...context.store.get("state"),
      windowBounds: context.requireMainWindow().getNormalBounds(),
      windowMaximized: context.requireMainWindow().isMaximized(),
    });
  });
  context.mainWindow.on("session-end", () => context.store.flushSync());

  context.mainWindow.once("closed", () => {
    context.mainWindow = null;

    context.ytmView = null;

    if (!context.isApplicationQuitting) {
      app.quit();
    }
  });

  context.mainWindow.on("ready-to-show", () => {
    if (process.env.NODE_ENV === "development") {
      context.requireMainWindow().webContents.openDevTools({
        mode: "detach",
      });
    }
  });
  context.mainWindow.once("ready-to-show", () => {
    context.trayController.createTray();
    log.info("Created tray icon");
  });

  loadWindowEntry(context.mainWindow, "main", context.allWindowsViteDevServerUrl);
}
