import { app, autoUpdater } from "electron";
import log from "electron-log";

import { isNewerVersion } from "../../shared/update-feed";

import type { MainContext } from "../index";

export function installUpdateEvents(context: MainContext): void {
  if (context.updatesSupported()) {
    autoUpdater.on("checking-for-update", () => {
      if (context.isAppLaunchUpdateCheck) context.memoryStore.set("ytmViewLoadingStatus", "Checking for updates...");
      if (context.settingsWindow) context.settingsWindow.webContents.send("app:checkingForUpdates");
    });
    autoUpdater.on("update-available", () => {
      log.info("Application update available");
      context.memoryStore.set("appUpdateAvailable", true);
      context.isAppUpdateAvailable = true;
      if (context.isAppLaunchUpdateCheck) context.memoryStore.set("ytmViewLoadingStatus", "Downloading update...");
      if (context.settingsWindow) context.settingsWindow.webContents.send("app:updateAvailable");
    });
    autoUpdater.on("update-not-available", () => {
      if (context.isAppLaunchUpdateCheck) context.isAppLaunchUpdateCheck = false;
      context.isChannelSwitchInstall = false;
      if (context.settingsWindow) context.settingsWindow.webContents.send("app:updateNotAvailable");
    });
    autoUpdater.on("update-downloaded", (_event, _releaseNotes, releaseName) => {
      if (!isNewerVersion(releaseName, app.getVersion())) {
        log.info(`Ignoring downloaded update ${releaseName}: not newer than ${app.getVersion()}`);
        context.isAppLaunchUpdateCheck = false;
        context.isChannelSwitchInstall = false;
        if (context.settingsWindow) context.settingsWindow.webContents.send("app:updateNotAvailable");
        return;
      }

      log.info(`Application update downloaded: ${releaseName}`);
      context.isAppUpdateDownloaded = true;
      context.memoryStore.set("appUpdateDownloaded", true);
      if (context.isAppLaunchUpdateCheck) autoUpdater.quitAndInstall();
      if (context.isChannelSwitchInstall) {
        context.isChannelSwitchInstall = false;
        context.isApplicationQuitting = true;
        autoUpdater.quitAndInstall();
      }
      if (context.settingsWindow) context.settingsWindow.webContents.send("app:updateDownloaded");
    });
    autoUpdater.on("error", () => {
      if (context.isAppLaunchUpdateCheck) context.isAppLaunchUpdateCheck = false;
      context.isChannelSwitchInstall = false;
      if (context.settingsWindow) context.settingsWindow.webContents.send("app:updateNotAvailable");
    });
    log.info("Setup application updater");
  } else {
    context.memoryStore.set("autoUpdaterDisabled", true);
  }
}
