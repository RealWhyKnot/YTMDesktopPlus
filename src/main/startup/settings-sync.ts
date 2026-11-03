import { app, autoUpdater } from "electron";
import log from "electron-log";

import { stallTasks } from "../stall-watch";

import { isTestClient } from "../test-seams";

import { anyShortcutChanged } from "../shortcuts";

import { syncIntegrations } from "../integrations/lifecycle";

import type { MainContext } from "../index";
import type { StoreSchema } from "~shared/store/schema";

function updateChannelChanged(current: StoreSchema["updates"] | null | undefined, previous: StoreSchema["updates"] | null | undefined): boolean {
  if (!current || !previous) return false;
  return current.channel !== previous.channel;
}

function flagChanged(current: unknown, previous: unknown): boolean {
  return Boolean(current) !== Boolean(previous);
}

export function watchSettings(context: MainContext): void {
  const applySettings = async (newState: StoreSchema, oldState: StoreSchema | undefined) => {
    context.broadcastToWindows("settings:stateChanged", { includeMainWindow: false }, newState, oldState);

    if (process.env.NODE_ENV !== "development" && !isTestClient() && newState.general.startOnBoot !== context.isAppliedStartOnBoot) {
      context.isAppliedStartOnBoot = newState.general.startOnBoot;
      stallTasks.timeSync("app.setLoginItemSettings", () =>
        app.setLoginItemSettings({
          openAtLogin: newState.general.startOnBoot,
        })
      );
    }

    if (oldState === undefined) throw new Error("Previous settings are unavailable");
    syncIntegrations(context.integrationRegistrations, newState, oldState);

    if (newState.developer.debugLogging !== oldState.developer.debugLogging) {
      context.applyDebugLogging();
      log.info(`Debug logging ${newState.developer.debugLogging ? "enabled" : "disabled"}`);
    }

    if (updateChannelChanged(newState.updates, oldState.updates)) {
      if (context.updatesSupported()) {
        log.info(`Update channel changed, checking feed for channel setting ${newState.updates.channel}`);
        context.applyUpdateFeed();
        if (!context.isAppUpdateDownloaded) {
          context.isChannelSwitchInstall = true;
          autoUpdater.checkForUpdates();
        }
      }
    }

    if (newState.appearance.zoom !== oldState.appearance.zoom) {
      if (context.ytmView) {
        context.ytmView.webContents.setZoomFactor(newState.appearance.zoom / 100);
        log.info("Integration update: Zoom Factor");
      }
    }

    if (oldState.appearance.trayIconStyle !== newState.appearance.trayIconStyle) context.trayController.setTrayIcon();

    if (newState.playback.adBlockerEnabled && !oldState.playback.adBlockerEnabled) {
      context.adBlocker.enable();
    } else if (!newState.playback.adBlockerEnabled && oldState.playback.adBlockerEnabled) {
      context.adBlocker.disable();
    }

    if (
      !newState.integrations.companionServerEnabled &&
      oldState.integrations.companionServerEnabled &&
      context.memoryStore.get("companionServerAuthWindowEnabled")
    ) {
      context.memoryStore.set("companionServerAuthWindowEnabled", false);
    }

    const isCompanionServerRestartNeeded =
      flagChanged(newState.integrations.companionServerCORSWildcardEnabled, oldState.integrations.companionServerCORSWildcardEnabled) ||
      flagChanged(newState.integrations.companionServerLANEnabled, oldState.integrations.companionServerLANEnabled);
    if (isCompanionServerRestartNeeded && newState.integrations.companionServerEnabled && oldState.integrations.companionServerEnabled) {
      await context.companionServer.disable();
      await context.companionServer.enable();
    }

    if (newState.integrations.discordPresenceHideOnPause !== oldState.integrations.discordPresenceHideOnPause) {
      context.discordPresence.refreshActivity();
    }

    if (anyShortcutChanged(newState, oldState)) context.registerShortcuts();
  };
  context.store.onDidAnyChange((newState, oldState) => {
    void applySettings(newState, oldState).catch((error: unknown) => log.error("Settings could not be applied", error));
  });
}
