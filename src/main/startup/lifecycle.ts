import { powerMonitor, screen, app, BrowserWindow, nativeTheme, safeStorage, session } from "electron";
import log from "electron-log";
import path from "path";

import { scanExternalAddons } from "../addons/external-loader";

import { switchLogFileToSync } from "../logging";
import { markSystemEvents, stallTasks } from "../stall-watch";

import { cancelCue } from "../playback";

import { setupTaskbarFeatures } from "../taskbar";
import { enableIntegrationsAtBoot } from "../integrations/lifecycle";

import { migrateV1Settings } from "../startup/migrate-v1-settings";
import { installApplicationIpc } from "../startup/ipc";
import { initializeThemes } from "../startup/themes";

import { startAddonsAndUpdates } from "../startup/addons-and-updates";
import type { MainContext } from "../index";

export function installLifecycle(context: MainContext): void {
  const onReady = async () => {
    log.info("Application ready");
    markSystemEvents({ screen, powerMonitor }, stallTasks, (label) => log.info(`System event: ${label}`));

    await migrateV1Settings(context);

    if (!safeStorage.isEncryptionAvailable()) {
      context.memoryStore.set("safeStorageAvailable", false);
    } else {
      context.memoryStore.set("safeStorageAvailable", true);
    }

    const { isSettingsSender, addonsDirPath } = installApplicationIpc(context);

    context.adBlocker.provide(
      session.fromPartition(app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev"),

      path.join(app.getPath("userData"), "adblocker-engine-network.bin")
    );
    if (context.store.get("playback").adBlockerEnabled) {
      context.adBlocker.enable();
    }

    context.registerShortcuts();

    await initializeThemes(context, addonsDirPath, isSettingsSender);

    const externalAddonScans = scanExternalAddons(addonsDirPath);
    context.addonManager.registerExternal(externalAddonScans);

    await startAddonsAndUpdates(context, externalAddonScans);

    context.createYTMView();
    log.info("Created YTM view");

    setupTaskbarFeatures({
      store: context.store,
      getMainWindow: () => context.mainWindow,
      sendRemoteCommand: context.sendRemoteCommand,
      getControlsIconPath: context.getControlsIconPath,
    });
    log.info("Setup taskbar features");

    if (context.store.get("appearance").zoom) {
      log.info("Integration update: Zoom Factor");
      context.requireYtmView().webContents.setZoomFactor(context.store.get("appearance").zoom / 100);
    }

    log.info("Starting enabled integrations");

    enableIntegrationsAtBoot(context.integrationRegistrations, context.store.store);

    nativeTheme.on("updated", () => context.trayController.setTrayIcon());
  };
  app.on("ready", () => {
    void onReady().catch((error: unknown) => log.error("Application startup failed", error));
  });

  let isAddonShutdownSettled = false;
  app.on("before-quit", (event) => {
    switchLogFileToSync();
    log.info("Application quitting\n\n");
    context.isApplicationQuitting = true;
    cancelCue();
    context.store.flushSync();
    context.saveState();
    if (!isAddonShutdownSettled) {
      event.preventDefault();
      const finish = () => {
        isAddonShutdownSettled = true;
        app.quit();
      };
      void Promise.race([Promise.all([context.addonManager.shutdown(), context.store.flush()]), new Promise((resolve) => setTimeout(resolve, 3000))])
        .then(finish, finish)
        .catch((error: unknown) => log.warn("installLifecycle failed", error));
    }
  });

  app.on("open-url", (_, url) => {
    context.deepLinks.handleProtocol(url);
  });

  app.on("window-all-closed", () => {
    if (!context.isDarwin) {
      app.quit();
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      context.createMainWindow();
      context.createYTMView();
    }
  });
}
