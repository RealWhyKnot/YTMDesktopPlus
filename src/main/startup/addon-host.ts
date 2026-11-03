import { cueTrack, sendPlaybackCommand, getPlaylists } from "../playback";
import { app, ipcMain, Notification } from "electron";

import path from "path";
import { randomUUID } from "crypto";

import { AddonManager } from "../addons/manager";

import { playerStateStore, playerEvents } from "../player-state-store";

import { senderIsView } from "../ipc/sender-guards";

import { createAppWindow, loadWindowEntry } from "../windows/window-factory";

import type { MainContext } from "../index";
import { isRecord } from "~shared/unknown";

export function createAddonHost(context: MainContext): AddonManager {
  return new AddonManager({
    store: context.store,
    memoryStore: context.memoryStore,
    appVersion: app.getVersion(),
    userDataPath: app.getPath("userData"),
    getYtmView: () => context.ytmView,
    registerYtmScript: (namespace, name, script) => {
      let scripts = context.ytmViewIntegrationScripts.get(namespace);
      if (scripts === undefined) {
        scripts = new Map<string, string>();
        context.ytmViewIntegrationScripts.set(namespace, scripts);
      }
      scripts.set(name, script);

      if (context.ytmView?.webContents && !context.ytmView.webContents.isDestroyed()) {
        context.ytmView.webContents.send("ytmView:scriptRegistered", namespace, name, script);
      }
    },
    invokeYtmScript: (namespace, name, arg) =>
      new Promise((resolve, reject) => {
        const view = context.ytmView;
        if (!view?.webContents || view.webContents.isDestroyed()) {
          reject(new Error("YTM view unavailable"));
          return;
        }
        const requestId = randomUUID();
        const channel = `ytmView:invokeScript:response:${requestId}`;
        const listener = (event: Electron.IpcMainEvent, result: unknown) => {
          if (!senderIsView(view, event.sender)) return;
          clearTimeout(timeout);
          if (isRecord(result) && result.ok === true) resolve(result.value);
          else reject(new Error(isRecord(result) && typeof result.error === "string" ? result.error : `script ${namespace}/${name} failed`));
        };
        const timeout = setTimeout(() => {
          ipcMain.removeListener(channel, listener);
          reject(new Error(`script ${namespace}/${name} timed out`));
        }, 30 * 1000);
        ipcMain.once(channel, listener);
        view.webContents.send("ytmView:invokeScript", namespace, name, requestId, arg);
      }),
    player: {
      getState: () => playerStateStore.getState(),
      getQueue: () => playerStateStore.getQueue(),
      getPlaylistId: () => playerStateStore.getPlaylistId(),
      addEventListener: (listener) => playerStateStore.addEventListener(listener),
      removeEventListener: (listener) => playerStateStore.removeEventListener(listener),
      events: {
        on: (event, listener) => playerEvents.on(event, listener),
        off: (event, listener) => playerEvents.off(event, listener),
      },
    },
    playback: {
      cueTrack,
      sendPlaybackCommand,
      getPlaylists,
    },
    ipc: {
      handle: (channel, listener) => ipcMain.handle(channel, listener),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
      on: (channel, listener) => {
        ipcMain.on(channel, listener);
      },
      removeListener: (channel, listener) => {
        ipcMain.removeListener(channel, listener);
      },
    },
    refreshTrayMenu: () => {
      context.trayController.refreshTrayMenu();
    },
    isAppSender: (sender) =>
      sender === context.mainWindow?.webContents ||
      sender === context.settingsWindow?.webContents ||
      sender === context.ytmView?.webContents ||
      (context.isAddonManagerCreated && context.addonManager.ownsWebContents(sender)),
    notify: (options) => {
      const notification = new Notification({ title: options.title, body: options.body });
      if (options.onClick) notification.on("click", options.onClick);
      notification.show();
    },
    createWindow: (options) => {
      const anchorBounds = context.mainWindow?.getBounds();
      const addonWindow = createAppWindow({
        width: options.width,
        height: options.height,
        x: anchorBounds ? Math.round(anchorBounds.x + (anchorBounds.width / 2 - options.width / 2)) : undefined,
        y: anchorBounds ? Math.round(anchorBounds.y + (anchorBounds.height / 2 - options.height / 2)) : undefined,
        minimizable: false,
        maximizable: false,
        resizable: options.resizable ?? false,
        show: false,
        title: options.title,
        icon: context.getIconPath("ytmd.png"),
        webPreferences: {
          preload: options.filePath
            ? path.join(__dirname, "../renderer/windows/addon/preload.js")
            : path.join(__dirname, `../renderer/windows/${options.entry}/preload.js`),
          additionalArguments: options.filePath
            ? [`--ytmd-addon-id=${options.addonId}`, `--ytmd-addon-theme=${options.themed === false ? "0" : "1"}`]
            : undefined,
          devTools: context.store.get("developer").enableDevTools,

          backgroundThrottling: options.show !== false,
        },
      });
      if (options.show !== false) addonWindow.on("ready-to-show", () => addonWindow.show());
      if (options.filePath) void addonWindow.loadFile(options.filePath).catch((error: unknown) => console.warn("createAddonHost failed", error));
      else {
        if (options.entry === undefined) throw new Error("Addon window entry is missing");
        loadWindowEntry(addonWindow, options.entry, context.allWindowsViteDevServerUrl);
      }
      return addonWindow;
    },
    discord: {
      isEnabled: () => context.store.get("integrations").discordPresenceEnabled,
      onEnabledChanged: (callback) =>
        context.store.onDidChange("integrations", (newValue, oldValue) => {
          if (newValue && oldValue && newValue.discordPresenceEnabled !== oldValue.discordPresenceEnabled) {
            callback(newValue.discordPresenceEnabled);
          }
        }),
      registerButtonsProvider: (provider) => context.discordPresence.registerButtonsProvider(provider),
      registerRemoteActivityProvider: (provider) => context.discordPresence.registerRemoteActivityProvider(provider),
      refreshActivity: () => context.discordPresence.refreshActivity(),
    },
    deepLinks: {
      register: context.deepLinks.registerDeepLink,
    },
    theme: {
      get: () => context.themeManager?.activeTheme() ?? { id: null, name: "None", tokens: {} },
      subscribe: (listener) => (context.themeManager === null ? () => undefined : context.themeManager.onChange(listener)),
    },
  });
}
