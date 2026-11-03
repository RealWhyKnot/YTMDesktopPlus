import { app, autoUpdater, dialog } from "electron";
import log from "electron-log";
import path from "path";

import { scanExternalAddons } from "../addons/external-loader";
import { watchExternalAddonsForDev } from "../addons/dev-reload";

import { createAppWindow, loadWindowEntry } from "../windows/window-factory";

import { mediaHost } from "../media/media-host";

import type { MainContext } from "../index";

export async function startAddonsAndUpdates(context: MainContext, externalAddonScans: ReturnType<typeof scanExternalAddons>): Promise<void> {
  mediaHost.provide(() => {
    const window = createAppWindow({
      width: 1,
      height: 1,
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, "../renderer/windows/media-host/preload.js"),
        backgroundThrottling: false,
      },
    });
    loadWindowEntry(window, "media-host", context.allWindowsViteDevServerUrl);
    return window;
  });

  const addonsBooted = context.addonManager.boot().then(
    () => log.info("Addons booted"),
    (error: unknown) => log.error("Addons failed to boot", error)
  );

  if (process.env.YTMD_ADDON_DEV === "1" && !app.isPackaged) {
    watchExternalAddonsForDev(externalAddonScans, (id) => addonsBooted.then(() => context.addonManager.reloadExternal(id)), log);
    log.info("Addon dev reload is watching the addons directory");
  }

  context.createMainWindow();
  log.info("Created main window");

  context.memoryStore.set("ytmViewLoading", true);
  context.memoryStore.set("ytmViewLoadingStatus", "Checking for updates...");

  if (context.updatesSupported()) {
    if (!context.store.get("updates").firstRunPromptShown) {
      const promptResult = await dialog.showMessageBox({
        type: "question",
        title: "Automatic updates",
        message: "Install updates automatically when the app starts?",
        detail: "You can change this at any time in Settings.",
        buttons: ["Enable automatic updates", "Not now"],
        defaultId: 0,
        cancelId: 1,
      });
      context.store.set("updates.firstRunPromptShown", true);
      context.store.set("updates.autoUpdateEnabled", promptResult.response === 0);
    }

    if (context.store.get("updates").autoUpdateEnabled) {
      autoUpdater.checkForUpdates();
      await new Promise<void>((resolve) => {
        setInterval(() => {
          if (!context.isAppLaunchUpdateCheck) resolve();
        }, 250);
      });
    } else {
      context.isAppLaunchUpdateCheck = false;
    }
  } else {
    context.isAppLaunchUpdateCheck = false;
  }

  context.ytmViewIntegrationScripts.set("ratioVolume", new Map(context.ratioVolume.getYTMScripts().map(({ name, script }) => [name, script])));
  context.ytmViewIntegrationScripts.set("nonStop", new Map(context.nonStop.getYTMScripts().map(({ name, script }) => [name, script])));
  context.ytmViewIntegrationScripts.set("adBlock", new Map(context.adBlocker.getYTMScripts().map(({ name, script }) => [name, script])));
}
