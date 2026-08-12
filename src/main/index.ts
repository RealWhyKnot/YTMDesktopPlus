import {
  app,
  autoUpdater,
  BrowserView,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  nativeTheme,
  Notification,
  safeStorage,
  screen,
  session,
  shell,
  Tray
} from "electron";
import log from "electron-log";
import path from "path";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import electronSquirrelStartup from "electron-squirrel-startup";

import MemoryStore from "./memory-store";
import { AddonManager } from "./addons/manager";
import { scanExternalAddons } from "./addons/external-loader";
import { watchExternalAddonsForDev } from "./addons/dev-reload";
import { filterLogTailForAddon } from "./addons/log-tail";
import { migrateCustomCssSetting } from "./addons/migrate-custom-css";
import { BUNDLED_ADDONS } from "../addons/bundled";
import playerStateStore, { playerEvents, PlayerState, VideoState } from "./player-state-store";
import { setLogOutputEnabled, setupLogging } from "./logging";
import { MemoryStoreSchema, StoreSchema, TrayIconStyle } from "../shared/store/schema";

import CompanionServer from "./integrations/companion-server";
import DiscordPresence from "./integrations/discord-presence";
import LastFM from "./integrations/last-fm";
import NowPlayingNotifications from "./integrations/notifications";
import VolumeRatio from "./integrations/volume-ratio";
import NonStop from "./integrations/nonstop";
import AdBlocker from "./integrations/ad-blocker";
import ListenAlong from "./integrations/listen-along";
import { initializeTestSeams, isTestRun } from "./test-seams";
import { migrateLegacyProfile } from "./profile-migration";
import { cancelCue, cueTrack, getPlaylists, providePlaybackView, sendPlaybackCommand } from "./playback";
import { createLaunchPause } from "./playback/launch-pause";
import { createSenderGuards, senderIsView } from "./ipc/sender-guards";
import { createAppWindow, loadWindowEntry } from "./windows/window-factory";
import { createAppStore } from "./store/create-store";
import { createStoreBroadcaster } from "./windows/broadcast";
import { createDeepLinkRouter, findProtocolUrl } from "./deep-links";
import { buildUpdateFeedUrl, isNewerVersion } from "../shared/update-feed";

// Injected by Forge's Vite plugin; empty in packaged builds.
declare const ALL_WINDOWS_VITE_DEV_SERVER_URL: string;

declare const YTMD_DISABLE_UPDATES: boolean;
declare const YTMD_LOCAL_BUILD: boolean;
declare const YTMD_DEV_TOOLS: boolean;

// The remote-playback probe ships only in dev and local builds (YTMD_DEV_TOOLS)
// and stays dormant until launched with YTMD_REMOTE_PROBE=1, so a normal local
// install is undisturbed. It appends its observations to logs/remote-probe.jsonl.
const remoteProbeActive = YTMD_DEV_TOOLS && process.env.YTMD_REMOTE_PROBE === "1";

// Must run before anything reads userData (logging, single instance lock,
// config store).
initializeTestSeams();
const migratedLegacyProfile = migrateLegacyProfile();

const assetFolder = path.join(process.env.NODE_ENV === "development" ? path.join(app.getAppPath(), "src/assets") : process.resourcesPath);
const isDarwin = process.platform === "darwin";

let applicationExited = false;
let applicationQuitting = false;
let appUpdateAvailable = false;
let appUpdateDownloaded = false;
let appLaunchUpdateCheck = true;

let stateSaverInterval: NodeJS.Timeout | null = null;

//#region   Crash + Error reporting
crashReporter.start({ uploadToServer: false });

// Log output starts disabled in packaged builds so nothing is written unless
// debug logging is enabled. Development builds always write logs. The stored
// setting is applied once the config store is constructed below.
setupLogging(app.isPackaged);
if (migratedLegacyProfile) {
  log.info("Migrated settings and session data from the previous installation");
}
// Handle logs and errors
log.errorHandler.startCatching({
  showDialog: false,
  onError({ error, processType, versions }) {
    if (applicationExited) return;
    if (processType === "renderer") return;

    if (stateSaverInterval) clearInterval(stateSaverInterval);

    // This just ensures AggregateError sub errors is being unwrapped properly and logged
    if (error instanceof AggregateError) {
      log.error(error);
      for (const subError of error.errors) {
        log.error(subError);
      }
    } else {
      log.error(error);
    }

    let result = 1; // Default to Exit

    const dialogMessage =
      `Environment Details:\n    ${versions.app}\n    ${versions.electron}\n    ${versions.os}\n\n` +
      `Name: ${error.name}\nMessage: ${error.message}\nCause: ${error.cause ?? "Unknown"}\n\n` +
      `${error.stack}`;

    if (!app.isReady()) {
      dialog.showErrorBox(`YTMDesktop+ Crashed`, `Application crashed before ready\n\n${dialogMessage}`);
    } else {
      const options = ["Copy to Clipboard and Exit", "Exit"];
      if (!app.isPackaged) {
        options.push("Copy to Clipboard and Continue", "Continue");
      }

      result = dialog.showMessageBoxSync({
        title: "Error",
        message: "YTMDesktop+ Crashed",
        detail: dialogMessage,
        type: "error",
        buttons: options
      });

      // Copy to Clipboard
      if (result === 0 || result === 2) {
        clipboard.writeText(`YTMDesktop+ Crashed\n\n${dialogMessage}`);
      }
    }

    // Exit
    if (result === 0 || result === 1) {
      applicationExited = true;
      app.exit(1);
    }
  }
});
log.eventLogger.startLogging();

Object.assign(console, log.functions);
//#endregion  Crash + Error reporting

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (electronSquirrelStartup) {
  app.quit();
}

log.info("Application launched");

// Enforce sandbox on all renderers
app.enableSandbox();

// appMenu allows for some basic windows management, editMenu allow for copy and paste shortcuts on MacOS
const template: MenuItemConstructorOptions[] = [{ role: "appMenu", label: "YTMDesktop+" }, { role: "editMenu" }];
const builtMenu = isDarwin ? Menu.buildFromTemplate(template) : null; // null for performance https://www.electronjs.org/docs/latest/tutorial/performance#8-call-menusetapplicationmenunull-when-you-do-not-need-a-default-menu
Menu.setApplicationMenu(builtMenu);

const companionServer = new CompanionServer();
const discordPresence = new DiscordPresence();
const lastFMScrobbler = new LastFM();
const listenAlong = new ListenAlong();
const nowPlayingNotifications = new NowPlayingNotifications();
const ratioVolume = new VolumeRatio();
const nonStop = new NonStop();
const adBlocker = new AdBlocker();

const ytmViewIntegrationScripts: { [name: string]: { [name: string]: string } } = {};

let mainWindow: BrowserWindow = null;
let settingsWindow: BrowserWindow = null;
let ytmView: BrowserView = null;
let tray: Tray = null;

// These variables tend to be changed often so we store it in memory and write on close (less disk usage)
let lastUrl = "";
let lastVideoId = "";
let lastPlaylistId = "";

let companionAuthWindowEnableTimeout: NodeJS.Timeout | null = null;
let ytmViewLoadTimeout: NodeJS.Timeout | null = null;

// These are global accelerators: they fire whether or not the window is
// focused, so binding one takes that key away from every other application.
// Single Instances Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.exit(0);
} else {
  app.on("second-instance", (_, commandLine) => {
    if (mainWindow) {
      mainWindow.show();
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.focus();
    }

    deepLinks.handleProtocol(findProtocolUrl(commandLine));
  });
}

const deepLinks = createDeepLinkRouter({ hasYtmView: () => ytmView !== null });

// This will register the protocol in development, this is intentional and should stay this way for development purposes
// Test runs skip it: they should never change system-wide handler registrations.
if (!isTestRun() && !app.isDefaultProtocolClient("ytmdplus")) {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      log.info("Application set as default protocol client for 'ytmdplus'");
      app.setAsDefaultProtocolClient("ytmdplus", process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    log.info("Application set as default protocol client for 'ytmdplus'");
    app.setAsDefaultProtocolClient("ytmdplus", process.execPath);
  }
}

// Windows starts a closed app by handing the link to argv rather than raising
// second-instance, so nothing else picks it up.
if (!isTestRun()) {
  const launchUrl = findProtocolUrl(process.argv);
  if (launchUrl) {
    log.info("Queuing protocol url from launch arguments", launchUrl);
    deepLinks.queueProtocolUrl(launchUrl);
  }
}

// Create the in-memory store for state within the UI.
// The addon manager is constructed after the settings store further down; the
// flag keeps this broadcast from touching it before it exists.
let addonManagerCreated = false;
const memoryStore = new MemoryStore<MemoryStoreSchema>();
const broadcastToWindows = createStoreBroadcaster({
  getMainWindow: () => mainWindow,
  getSettingsWindow: () => settingsWindow,
  getYtmView: () => ytmView,
  addonWebContents: () => (addonManagerCreated ? addonManager.windowWebContents() : [])
});

memoryStore.onStateChanged((newState, oldState) => {
  broadcastToWindows("memoryStore:stateChanged", { includeMainWindow: true }, newState, oldState);
});
log.info("Created memory store");

// Pauses the restored track once it reports playing, see playback/launch-pause
const launchPause = createLaunchPause({
  addEventListener: listener => playerStateStore.addEventListener(listener),
  removeEventListener: listener => playerStateStore.removeEventListener(listener),
  send: command => sendPlaybackCommand(command)
});

function shouldDisableUpdates() {
  // macOS can't have auto updates without a code signature
  // linux is not supported on the update server https://github.com/ytmdesktop/ytmdesktop/issues/1247 (hanging issue resolved)
  if (process.platform !== "win32") return true;
  // A build installed from a working tree is ahead of anything published, so
  // checking would only poll a feed that can never have something newer.
  if (YTMD_LOCAL_BUILD) return true;
}

function updatesSupported() {
  return app.isPackaged && !shouldDisableUpdates() && !YTMD_DISABLE_UPDATES;
}

// Set when a saved channel change triggers a check so the resulting download
// installs immediately instead of waiting for the next launch.
let channelSwitchInstall = false;

// Configure the autoupdater
// macOS cannot use the autoUpdater without a code signature at this time
// The feed URL and check interval are configured after the config store exists
if (updatesSupported()) {
  autoUpdater.on("checking-for-update", () => {
    if (appLaunchUpdateCheck) memoryStore.set("ytmViewLoadingStatus", "Checking for updates...");
    if (settingsWindow) settingsWindow.webContents.send("app:checkingForUpdates");
  });
  autoUpdater.on("update-available", () => {
    log.info("Application update available");
    memoryStore.set("appUpdateAvailable", true);
    appUpdateAvailable = true;
    if (appLaunchUpdateCheck) memoryStore.set("ytmViewLoadingStatus", "Downloading update...");
    if (settingsWindow) settingsWindow.webContents.send("app:updateAvailable");
  });
  autoUpdater.on("update-not-available", () => {
    if (appLaunchUpdateCheck) appLaunchUpdateCheck = false;
    channelSwitchInstall = false;
    if (settingsWindow) settingsWindow.webContents.send("app:updateNotAvailable");
  });
  autoUpdater.on("update-downloaded", (_event, _releaseNotes, releaseName) => {
    // Nothing is installed unless it is strictly newer than what is running, so
    // a feed serving an older or equal release cannot roll the app backwards.
    // releaseName carries the version on Windows; treat an unreadable one as
    // not newer rather than guessing.
    if (!isNewerVersion(releaseName, app.getVersion())) {
      log.info(`Ignoring downloaded update ${releaseName}: not newer than ${app.getVersion()}`);
      appLaunchUpdateCheck = false;
      channelSwitchInstall = false;
      if (settingsWindow) settingsWindow.webContents.send("app:updateNotAvailable");
      return;
    }

    log.info(`Application update downloaded: ${releaseName}`);
    appUpdateDownloaded = true;
    memoryStore.set("appUpdateDownloaded", true);
    if (appLaunchUpdateCheck) autoUpdater.quitAndInstall();
    if (channelSwitchInstall) {
      channelSwitchInstall = false;
      applicationQuitting = true;
      autoUpdater.quitAndInstall();
    }
    if (settingsWindow) settingsWindow.webContents.send("app:updateDownloaded");
  });
  autoUpdater.on("error", () => {
    if (appLaunchUpdateCheck) appLaunchUpdateCheck = false;
    channelSwitchInstall = false;
    if (settingsWindow) settingsWindow.webContents.send("app:updateNotAvailable");
  });
  log.info("Setup application updater");
} else {
  memoryStore.set("autoUpdaterDisabled", true);
}

function getIconPath(icon: string) {
  return path.join(assetFolder, `${process.env.NODE_ENV === "development" ? "icons/" : ""}${icon}`);
}
function getControlsIconPath(icon: string) {
  return getIconPath(`${process.env.NODE_ENV === "development" ? "controls/" : ""}${icon}`);
}

function anyShortcutChanged(newState: Readonly<StoreSchema>, oldState: Readonly<StoreSchema>) {
  if (newState.shortcuts.next !== oldState.shortcuts.next) return true;
  if (newState.shortcuts.playPause !== oldState.shortcuts.playPause) return true;
  if (newState.shortcuts.previous !== oldState.shortcuts.previous) return true;
  if (newState.shortcuts.thumbsDown !== oldState.shortcuts.thumbsDown) return true;
  if (newState.shortcuts.thumbsUp !== oldState.shortcuts.thumbsUp) return true;
  if (newState.shortcuts.volumeDown !== oldState.shortcuts.volumeDown) return true;
  if (newState.shortcuts.volumeUp !== oldState.shortcuts.volumeUp) return true;

  return false;
}

// Create the persistent config store
const store = createAppStore();

// Development builds always write logs. Packaged builds only write them when
// the debug logging setting is on.
const applyDebugLogging = () => setLogOutputEnabled(!app.isPackaged || store.get("developer").debugLogging);
applyDebugLogging();

const addonManager: AddonManager = new AddonManager({
  store,
  memoryStore,
  appVersion: app.getVersion(),
  userDataPath: app.getPath("userData"),
  getYtmView: () => ytmView,
  registerYtmScript: (namespace, name, script) => {
    if (!ytmViewIntegrationScripts[namespace]) ytmViewIntegrationScripts[namespace] = {};
    ytmViewIntegrationScripts[namespace][name] = script;
    // Live push for a page that is already up; before the page attaches its
    // listener this is a no-op and the load-time snapshot covers it.
    if (ytmView && !ytmView.webContents.isDestroyed()) {
      ytmView.webContents.send("ytmView:scriptRegistered", namespace, name, script);
    }
  },
  invokeYtmScript: (namespace, name, arg) =>
    new Promise((resolve, reject) => {
      const view = ytmView;
      if (!view) {
        reject(new Error("YTM view unavailable"));
        return;
      }
      const requestId = randomUUID();
      const channel = `ytmView:invokeScript:response:${requestId}`;
      const listener = (event: Electron.IpcMainEvent, result: { ok: boolean; value?: unknown; error?: string }) => {
        if (!senderIsView(view, event.sender)) return;
        clearTimeout(timeout);
        if (result?.ok) resolve(result.value);
        else reject(new Error(result?.error ?? `script ${namespace}/${name} failed`));
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
    addEventListener: listener => playerStateStore.addEventListener(listener),
    removeEventListener: listener => playerStateStore.removeEventListener(listener),
    events: {
      on: (event, listener) => playerEvents.on(event, listener),
      off: (event, listener) => playerEvents.off(event, listener)
    }
  },
  playback: {
    cueTrack,
    sendPlaybackCommand,
    getPlaylists
  },
  ipc: {
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    removeHandler: channel => ipcMain.removeHandler(channel),
    on: (channel, listener) => {
      ipcMain.on(channel, listener);
    },
    removeListener: (channel, listener) => {
      ipcMain.removeListener(channel, listener);
    }
  },
  refreshTrayMenu: () => {
    if (tray) tray.setContextMenu(Menu.buildFromTemplate(buildTrayContextMenu()));
  },
  isAppSender: sender =>
    Boolean(
      (mainWindow && sender === mainWindow.webContents) ||
      (settingsWindow && sender === settingsWindow.webContents) ||
      (ytmView && sender === ytmView.webContents) ||
      (addonManagerCreated && addonManager.ownsWebContents(sender))
    ),
  notify: options => {
    const notification = new Notification({ title: options.title, body: options.body });
    if (options.onClick) notification.on("click", options.onClick);
    notification.show();
  },
  createWindow: options => {
    const anchorBounds = mainWindow?.getBounds();
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
      icon: getIconPath("ytmd.png"),
      webPreferences: {
        preload: options.filePath
          ? path.join(__dirname, "../renderer/windows/addon/preload.js")
          : path.join(__dirname, `../renderer/windows/${options.entry}/preload.js`),
        additionalArguments: options.filePath ? [`--ytmd-addon-id=${options.addonId}`] : undefined,
        devTools: store.get("developer.enableDevTools")
      }
    });
    addonWindow.on("ready-to-show", () => addonWindow.show());
    if (options.filePath) addonWindow.loadFile(options.filePath);
    else loadWindowEntry(addonWindow, options.entry, ALL_WINDOWS_VITE_DEV_SERVER_URL);
    return addonWindow;
  },
  discord: {
    isEnabled: () => store.get("integrations").discordPresenceEnabled,
    onEnabledChanged: callback =>
      store.onDidChange("integrations", (newValue, oldValue) => {
        if (newValue && oldValue && newValue.discordPresenceEnabled !== oldValue.discordPresenceEnabled) {
          callback(newValue.discordPresenceEnabled);
        }
      }),
    registerButtonsProvider: provider => discordPresence.registerButtonsProvider(provider),
    registerRemoteActivityProvider: provider => discordPresence.registerRemoteActivityProvider(provider),
    refreshActivity: () => discordPresence.refreshActivity()
  },
  deepLinks: {
    register: deepLinks.registerDeepLink
  }
});
addonManager.registerBundled(BUNDLED_ADDONS);
addonManagerCreated = true;

const applyUpdateFeed = () =>
  autoUpdater.setFeedURL({
    url: buildUpdateFeedUrl(store.get("updates").channel, app.getVersion(), process.platform, process.arch)
  });

if (updatesSupported()) {
  applyUpdateFeed();
  setInterval(
    () => {
      if (store.get("updates").autoUpdateEnabled) autoUpdater.checkForUpdates();
    },
    1000 * 60 * 15
  );
}

store.onDidAnyChange(async (newState, oldState) => {
  broadcastToWindows("settings:stateChanged", { includeMainWindow: false }, newState, oldState);

  // Setting start on boot in development tends to cause a blank electron executable to start on boot so let's never set that
  if (process.env.NODE_ENV !== "development") {
    app.setLoginItemSettings({
      openAtLogin: newState.general.startOnBoot
    });
  }

  // General
  if (newState.general.showNotificationOnSongChange && !oldState.general.showNotificationOnSongChange) {
    nowPlayingNotifications.enable();
    log.info("Integration enabled: Now playing notifications");
  } else if (!newState.general.showNotificationOnSongChange && oldState.general.showNotificationOnSongChange) {
    nowPlayingNotifications.disable();
    log.info("Integration disabled: Now playing notifications");
  }

  if (newState.developer.debugLogging !== oldState.developer.debugLogging) {
    applyDebugLogging();
    log.info(`Debug logging ${newState.developer.debugLogging ? "enabled" : "disabled"}`);
  }

  // A saved channel change re-points the feed and applies the update right away
  if (newState.updates && oldState.updates && newState.updates.channel !== oldState.updates.channel) {
    if (updatesSupported()) {
      log.info(`Update channel changed, checking feed for channel setting ${newState.updates.channel}`);
      applyUpdateFeed();
      if (!appUpdateDownloaded) {
        channelSwitchInstall = true;
        autoUpdater.checkForUpdates();
      }
    }
  }

  if (newState.appearance.zoom !== oldState.appearance.zoom) {
    if (ytmView) {
      ytmView.webContents.setZoomFactor(newState.appearance.zoom / 100);
      log.info("Integration update: Zoom Factor");
    }
  }

  // Appearance
  if (oldState.appearance.trayIconStyle !== newState.appearance.trayIconStyle) setTrayIcon();

  // Playback
  if (newState.playback.ratioVolume) {
    ratioVolume.provide(ytmView);
  }
  if (newState.playback.ratioVolume && !oldState.playback.ratioVolume) {
    ratioVolume.enable();
    log.info("Integration enabled: Ratio volume");
  } else if (!newState.playback.ratioVolume && oldState.playback.ratioVolume) {
    ratioVolume.disable();
    log.info("Integration disabled: Ratio volume");
  }

  if (newState.playback.preventIdlePause) {
    nonStop.provide(ytmView);
  }
  if (newState.playback.preventIdlePause && !oldState.playback.preventIdlePause) {
    nonStop.enable();
    log.info("Integration enabled: Prevent idle pause");
  } else if (!newState.playback.preventIdlePause && oldState.playback.preventIdlePause) {
    nonStop.disable();
    log.info("Integration disabled: Prevent idle pause");
  }

  if (newState.playback.adBlockerEnabled && !oldState.playback.adBlockerEnabled) {
    adBlocker.enable();
  } else if (!newState.playback.adBlockerEnabled && oldState.playback.adBlockerEnabled) {
    adBlocker.disable();
  }

  // Integrations
  let companionServerAuthWindowEnabled = memoryStore.get("companionServerAuthWindowEnabled") ?? false;

  if (newState.integrations.companionServerEnabled) {
    companionServer.provide(store, memoryStore, ytmView);
  }
  if (newState.integrations.companionServerEnabled && !oldState.integrations.companionServerEnabled) {
    companionServer.enable();
    log.info("Integration enabled: Companion server");
  } else if (!newState.integrations.companionServerEnabled && oldState.integrations.companionServerEnabled) {
    companionServer.disable();
    log.info("Integration disabled: Companion server");

    if (companionServerAuthWindowEnabled) {
      memoryStore.set("companionServerAuthWindowEnabled", false);
      clearInterval(companionAuthWindowEnableTimeout);
      companionAuthWindowEnableTimeout = null;
      companionServerAuthWindowEnabled = false;
    }
  }

  if (companionServerAuthWindowEnabled) {
    if (!companionAuthWindowEnableTimeout) {
      companionAuthWindowEnableTimeout = setTimeout(() => {
        memoryStore.set("companionServerAuthWindowEnabled", null);
        companionAuthWindowEnableTimeout = null;
      }, 300 * 1000);
    }
  }

  if (newState.integrations.companionServerCORSWildcardEnabled && !oldState.integrations.companionServerCORSWildcardEnabled) {
    // Check if the companion server has been enabled and needs a restart from CORS wildcard change
    if (newState.integrations.companionServerEnabled && oldState.integrations.companionServerEnabled) {
      await companionServer.disable();
      await companionServer.enable();
    }
  } else if (!newState.integrations.companionServerCORSWildcardEnabled && oldState.integrations.companionServerCORSWildcardEnabled) {
    // Check if the companion server has been disabled and needs a restart from CORS wildcard change
    if (newState.integrations.companionServerEnabled && oldState.integrations.companionServerEnabled) {
      await companionServer.disable();
      await companionServer.enable();
    }
  }

  if (newState.integrations.discordPresenceEnabled) {
    discordPresence.provide(store, memoryStore);
  }
  if (newState.integrations.discordPresenceEnabled && !oldState.integrations.discordPresenceEnabled) {
    discordPresence.enable();
    log.info("Integration enabled: Discord presence");
  } else if (!newState.integrations.discordPresenceEnabled && oldState.integrations.discordPresenceEnabled) {
    discordPresence.disable();
    log.info("Integration disabled: Discord presence");
  }
  if (newState.integrations.discordPresenceHideOnPause !== oldState.integrations.discordPresenceHideOnPause) {
    // Takes effect immediately even while paused, not on the next player event
    discordPresence.refreshActivity();
  }

  if (newState.integrations.lastFMEnabled) {
    lastFMScrobbler.provide(store, memoryStore);
  }
  if (newState.integrations.lastFMEnabled && !oldState.integrations.lastFMEnabled) {
    lastFMScrobbler.enable();
    log.info("Integration enabled: Last.fm");
  } else if (!newState.integrations.lastFMEnabled && oldState.integrations.lastFMEnabled) {
    lastFMScrobbler.disable();
    log.info("Integration disabled: Last.fm");
  }

  if (newState.integrations.listenAlongEnabled) {
    listenAlong.provide(store, memoryStore);
  }
  if (newState.integrations.listenAlongEnabled && !oldState.integrations.listenAlongEnabled) {
    listenAlong.enable();
    log.info("Integration enabled: Listen along");
  } else if (!newState.integrations.listenAlongEnabled && oldState.integrations.listenAlongEnabled) {
    listenAlong.disable();
    log.info("Integration disabled: Listen along");
  }

  if (anyShortcutChanged(newState, oldState)) registerShortcuts();
});
log.info("Created electron store");

if (store.get("general").disableHardwareAcceleration) {
  app.disableHardwareAcceleration();
}

if (store.get("playback").enableSpeakerFill) {
  app.commandLine.appendSwitch("try-supported-channel-layouts");
}

function saveState() {
  store.set("state.lastUrl", lastUrl);
  store.set("state.lastVideoId", lastVideoId);
  store.set("state.lastPlaylistId", lastPlaylistId);
}

// Automatic background state saving every 5 minutes
stateSaverInterval = setInterval(
  () => {
    saveState();
  },
  5 * 60 * 1000
);

function setupTaskbarFeatures() {
  // Setup Taskbar Icons
  if (mainWindow && mainWindow.isVisible() && process.platform === "win32") {
    mainWindow.setThumbarButtons([
      {
        tooltip: "Previous",
        icon: nativeImage.createFromPath(getControlsIconPath("play-previous-button.png")),
        flags: ["disabled"],
        click() {
          if (ytmView) {
            ytmView.webContents.send("remoteControl:execute", "previous");
          }
        }
      },
      {
        tooltip: "Play/Pause",
        icon: nativeImage.createFromPath(getControlsIconPath("play-button.png")),
        flags: ["disabled"],
        click() {
          if (ytmView) {
            ytmView.webContents.send("remoteControl:execute", "playPause");
          }
        }
      },
      {
        tooltip: "Next",
        icon: nativeImage.createFromPath(getControlsIconPath("play-next-button.png")),
        flags: ["disabled"],
        click() {
          if (ytmView) {
            ytmView.webContents.send("remoteControl:execute", "next");
          }
        }
      }
    ]);
  }
  playerStateStore.addEventListener((state: PlayerState) => {
    const hasVideo = !!state.videoDetails;
    const isPlaying = state.trackState === VideoState.Playing;

    if (process.platform == "win32") {
      const taskbarFlags = [];
      if (!hasVideo) {
        taskbarFlags.push("disabled");
      }

      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.setThumbarButtons([
          {
            tooltip: "Previous",
            icon: nativeImage.createFromPath(getControlsIconPath("play-previous-button.png")),
            flags: taskbarFlags,
            click() {
              if (ytmView) {
                ytmView.webContents.send("remoteControl:execute", "previous");
              }
            }
          },
          {
            tooltip: "Play/Pause",
            icon: isPlaying
              ? nativeImage.createFromPath(getControlsIconPath("pause-button.png"))
              : nativeImage.createFromPath(getControlsIconPath("play-button.png")),
            flags: taskbarFlags,
            click() {
              if (ytmView) {
                ytmView.webContents.send("remoteControl:execute", "playPause");
              }
            }
          },
          {
            tooltip: "Next",
            icon: nativeImage.createFromPath(getControlsIconPath("play-next-button.png")),
            flags: taskbarFlags,
            click() {
              if (ytmView) {
                ytmView.webContents.send("remoteControl:execute", "next");
              }
            }
          }
        ]);
      }
    }

    if (mainWindow && store.get("playback.progressInTaskbar")) {
      mainWindow.setProgressBar(hasVideo ? state.videoProgress / state.videoDetails.durationSeconds : -1, {
        mode: isPlaying ? "normal" : "paused"
      });
    }
  });

  store.onDidChange("playback", (newValue, oldValue) => {
    if (mainWindow && newValue.progressInTaskbar !== oldValue.progressInTaskbar && !newValue.progressInTaskbar) {
      mainWindow.setProgressBar(-1);
    }
  });
}

// The static menu plus whatever tray items addons registered; rebuilt through
// refreshTrayMenu whenever those change.
function buildTrayContextMenu(): Electron.MenuItemConstructorOptions[] {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "YouTube Music Desktop",
      type: "normal",
      enabled: false
    },
    {
      type: "separator"
    },
    {
      label: "Show/Hide Window",
      type: "normal",
      click: () => {
        if (mainWindow) {
          if (mainWindow.isVisible()) {
            mainWindow.hide();
          } else {
            mainWindow.show();
          }
        }
      }
    },
    {
      label: "Play/Pause",
      type: "normal",
      click: () => {
        ytmView.webContents.send("remoteControl:execute", "playPause");
      }
    },
    {
      label: "Previous",
      type: "normal",
      click: () => {
        ytmView.webContents.send("remoteControl:execute", "previous");
      }
    },
    {
      label: "Next",
      type: "normal",
      click: () => {
        ytmView.webContents.send("remoteControl:execute", "next");
      }
    }
  ];

  const addonItems = addonManager.trayMenuItems();
  if (addonItems.length > 0) {
    template.push({ type: "separator" });
    for (const item of addonItems) {
      template.push({ label: item.label, type: "normal", enabled: item.enabled, click: item.click });
    }
  }

  template.push(
    { type: "separator" },
    {
      label: "Quit",
      type: "normal",
      click: () => {
        app.quit();
      }
    }
  );
  return template;
}

function trayIconFileName(style: TrayIconStyle) {
  if (process.platform === "win32") return "tray.ico";
  if (process.platform === "darwin") return "trayTemplate.png";

  let color: "white" | "black";
  if (style === TrayIconStyle.White) {
    color = "white";
  } else if (style === TrayIconStyle.Black) {
    color = "black";
  } else {
    color = nativeTheme.shouldUseDarkColors ? "white" : "black";
  }
  return `ytmd_${color}.png`;
}

function getTrayIconPath() {
  const style = store.get("appearance").trayIconStyle;
  const iconsDir = process.env.NODE_ENV === "development" ? path.join(app.getAppPath(), "src/assets/icons") : process.resourcesPath;
  return path.join(iconsDir, trayIconFileName(style));
}

function setTrayIcon() {
  tray.setImage(getTrayIconPath());
}

// Shortcut registration
function registerShortcuts() {
  const shortcuts = store.get("shortcuts");

  globalShortcut.unregisterAll();
  log.info("Unregistered shortcuts");

  if (shortcuts.playPause) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcuts.playPause, () => {
        if (ytmView) {
          ytmView.webContents.send("remoteControl:execute", "playPause");
        }
      });
    } catch {
      /* ignored */
    }

    if (!registered) {
      log.info("Failed to register shortcut: playPause");
      memoryStore.set("shortcutsPlayPauseRegisterFailed", true);
    } else {
      log.info("Registered shortcut: playPause");
      memoryStore.set("shortcutsPlayPauseRegisterFailed", false);
    }
  } else {
    memoryStore.set("shortcutsPlayPauseRegisterFailed", false);
  }

  if (shortcuts.next) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcuts.next, () => {
        if (ytmView) {
          ytmView.webContents.send("remoteControl:execute", "next");
        }
      });
    } catch {
      /* empty */
    }

    if (!registered) {
      log.info("Failed to register shortcut: next");
      memoryStore.set("shortcutsNextRegisterFailed", true);
    } else {
      log.info("Registered shortcut: next");
      memoryStore.set("shortcutsNextRegisterFailed", false);
    }
  } else {
    memoryStore.set("shortcutsNextRegisterFailed", false);
  }

  if (shortcuts.previous) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcuts.previous, () => {
        if (ytmView) {
          ytmView.webContents.send("remoteControl:execute", "previous");
        }
      });
    } catch {
      /* empty */
    }

    if (!registered) {
      log.info("Failed to register shortcut: previous");
      memoryStore.set("shortcutsPreviousRegisterFailed", true);
    } else {
      log.info("Registered shortcut: previous");
      memoryStore.set("shortcutsPreviousRegisterFailed", false);
    }
  } else {
    memoryStore.set("shortcutsPreviousRegisterFailed", false);
  }

  if (shortcuts.thumbsUp) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcuts.thumbsUp, () => {
        if (ytmView) {
          ytmView.webContents.send("remoteControl:execute", "toggleLike");
        }
      });
    } catch {
      /* empty */
    }

    if (!registered) {
      log.info("Failed to register shortcut: thumbsUp");
      memoryStore.set("shortcutsThumbsUpRegisterFailed", true);
    } else {
      log.info("Registered shortcut: thumbsUp");
      memoryStore.set("shortcutsThumbsUpRegisterFailed", false);
    }
  } else {
    memoryStore.set("shortcutsThumbsUpRegisterFailed", false);
  }

  if (shortcuts.thumbsDown) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcuts.thumbsDown, () => {
        if (ytmView) {
          ytmView.webContents.send("remoteControl:execute", "toggleDislike");
        }
      });
    } catch {
      /* empty */
    }

    if (!registered) {
      log.info("Failed to register shortcut: thumbsDown");
      memoryStore.set("shortcutsThumbsDownRegisterFailed", true);
    } else {
      log.info("Registered shortcut: thumbsDown");
      memoryStore.set("shortcutsThumbsDownRegisterFailed", false);
    }
  } else {
    memoryStore.set("shortcutsThumbsDownRegisterFailed", false);
  }

  if (shortcuts.volumeUp) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcuts.volumeUp, () => {
        if (ytmView) {
          ytmView.webContents.send("remoteControl:execute", "volumeUp");
        }
      });
    } catch {
      /* empty */
    }

    if (!registered) {
      log.info("Failed to register shortcut: volumeUp");
      memoryStore.set("shortcutsVolumeUpRegisterFailed", true);
    } else {
      log.info("Registered shortcut: volumeUp");
      memoryStore.set("shortcutsVolumeUpRegisterFailed", false);
    }
  } else {
    memoryStore.set("shortcutsVolumeUpRegisterFailed", false);
  }

  if (shortcuts.volumeDown) {
    let registered = false;
    try {
      registered = globalShortcut.register(shortcuts.volumeDown, () => {
        if (ytmView) {
          ytmView.webContents.send("remoteControl:execute", "volumeDown");
        }
      });
    } catch {
      /* empty */
    }

    if (!registered) {
      log.info("Failed to register shortcut: volumeDown");
      memoryStore.set("shortcutsVolumeDownRegisterFailed", true);
    } else {
      log.info("Registered shortcut: volumeDown");
      memoryStore.set("shortcutsVolumeDownRegisterFailed", false);
    }
  } else {
    memoryStore.set("shortcutsVolumeDownRegisterFailed", false);
  }

  log.info("Registered shortcuts");
}

// Functions which call to mainWindow renderer
function sendMainWindowStateIpc() {
  if (mainWindow !== null) {
    mainWindow.webContents.send("mainWindow:stateChanged", {
      minimized: mainWindow.isMinimized(),
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen()
    });
  }
}

// Functions with call to ytmView renderer
function ytmViewNavigated() {
  if (ytmView !== null) {
    const url = ytmView.webContents.getURL();
    if (url.startsWith("https://music.youtube.com/")) {
      lastUrl = url;
      ytmView.webContents.send("ytmView:navigationStateChanged", {
        canGoBack: ytmView.webContents.navigationHistory.canGoBack(),
        canGoForward: ytmView.webContents.navigationHistory.canGoForward()
      });
    }
  }
}

// Functions which call to settingsWindow renderer
function sendSettingsWindowStateIpc() {
  if (settingsWindow !== null) {
    settingsWindow.webContents.send("settingsWindow:stateChanged", {
      minimized: settingsWindow.isMinimized(),
      maximized: settingsWindow.isMaximized()
    });
  }
}

// Handles any navigation or window opening from ytmView
function openExternalFromYtmView(urlString: string) {
  const url = new URL(urlString);
  const domainSplit = url.hostname.split(".");
  domainSplit.reverse();
  const domain = `${domainSplit[1]}.${domainSplit[0]}`;
  if (domain === "google.com" || domain === "youtube.com") {
    shell.openExternal(urlString);
  }
}

const createOrShowSettingsWindow = (): void => {
  if (mainWindow === null) {
    return;
  }

  if (settingsWindow !== null) {
    settingsWindow.focus();
    return;
  }

  const mainWindowBounds = mainWindow.getBounds();

  // Create the browser window.
  settingsWindow = createAppWindow({
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
    icon: getIconPath("ytmd.png"),
    parent: mainWindow,
    modal: !isDarwin,
    openExternalUrls: ["https://github.com/RealWhyKnot/YTMDesktopPlus"],
    webPreferences: {
      preload: path.join(__dirname, `../renderer/windows/settings/preload.js`),
      devTools: store.get("developer.enableDevTools")
    }
  });

  // Attach events to settings window
  settingsWindow.on("maximize", sendSettingsWindowStateIpc);
  settingsWindow.on("unmaximize", sendSettingsWindowStateIpc);
  settingsWindow.on("minimize", sendSettingsWindowStateIpc);
  settingsWindow.on("restore", sendSettingsWindowStateIpc);

  settingsWindow.once("closed", () => {
    settingsWindow = null;
  });

  settingsWindow.on("ready-to-show", () => {
    settingsWindow.show();
    // Open the DevTools.
    if (process.env.NODE_ENV === "development") {
      settingsWindow.webContents.openDevTools({
        mode: "detach"
      });
    }
  });

  // and load the index.html of the app.
  loadWindowEntry(settingsWindow, "settings", ALL_WINDOWS_VITE_DEV_SERVER_URL);
};

function urlIsGoogleAccountsDomain(url: URL): boolean {
  // https://www.google.com/supported_domains
  // prettier-ignore
  const supportedDomains = [".google.com",".google.ad",".google.ae",".google.com.af",".google.com.ag",".google.al",".google.am",".google.co.ao",".google.com.ar",".google.as",".google.at",".google.com.au",".google.az",".google.ba",".google.com.bd",".google.be",".google.bf",".google.bg",".google.com.bh",".google.bi",".google.bj",".google.com.bn",".google.com.bo",".google.com.br",".google.bs",".google.bt",".google.co.bw",".google.by",".google.com.bz",".google.ca",".google.cd",".google.cf",".google.cg",".google.ch",".google.ci",".google.co.ck",".google.cl",".google.cm",".google.cn",".google.com.co",".google.co.cr",".google.com.cu",".google.cv",".google.com.cy",".google.cz",".google.de",".google.dj",".google.dk",".google.dm",".google.com.do",".google.dz",".google.com.ec",".google.ee",".google.com.eg",".google.es",".google.com.et",".google.fi",".google.com.fj",".google.fm",".google.fr",".google.ga",".google.ge",".google.gg",".google.com.gh",".google.com.gi",".google.gl",".google.gm",".google.gr",".google.com.gt",".google.gy",".google.com.hk",".google.hn",".google.hr",".google.ht",".google.hu",".google.co.id",".google.ie",".google.co.il",".google.im",".google.co.in",".google.iq",".google.is",".google.it",".google.je",".google.com.jm",".google.jo",".google.co.jp",".google.co.ke",".google.com.kh",".google.ki",".google.kg",".google.co.kr",".google.com.kw",".google.kz",".google.la",".google.com.lb",".google.li",".google.lk",".google.co.ls",".google.lt",".google.lu",".google.lv",".google.com.ly",".google.co.ma",".google.md",".google.me",".google.mg",".google.mk",".google.ml",".google.com.mm",".google.mn",".google.com.mt",".google.mu",".google.mv",".google.mw",".google.com.mx",".google.com.my",".google.co.mz",".google.com.na",".google.com.ng",".google.com.ni",".google.ne",".google.nl",".google.no",".google.com.np",".google.nr",".google.nu",".google.co.nz",".google.com.om",".google.com.pa",".google.com.pe",".google.com.pg",".google.com.ph",".google.com.pk",".google.pl",".google.pn",".google.com.pr",".google.ps",".google.pt",".google.com.py",".google.com.qa",".google.ro",".google.ru",".google.rw",".google.com.sa",".google.com.sb",".google.sc",".google.se",".google.com.sg",".google.sh",".google.si",".google.sk",".google.com.sl",".google.sn",".google.so",".google.sm",".google.sr",".google.st",".google.com.sv",".google.td",".google.tg",".google.co.th",".google.com.tj",".google.tl",".google.tm",".google.tn",".google.to",".google.com.tr",".google.tt",".google.com.tw",".google.co.tz",".google.com.ua",".google.co.ug",".google.co.uk",".google.com.uy",".google.co.uz",".google.com.vc",".google.co.ve",".google.co.vi",".google.com.vn",".google.vu",".google.ws",".google.rs",".google.co.za",".google.co.zm",".google.co.zw",".google.cat"];
  const domain = url.hostname.split("accounts")[1];
  if (supportedDomains.includes(domain)) return true;
  return false;
}
function isPreventedNavOrRedirect(url: URL): boolean {
  return (
    url.hostname !== "consent.youtube.com" &&
    url.hostname !== "accounts.youtube.com" &&
    url.hostname !== "music.youtube.com" &&
    !(
      (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") &&
      (url.pathname === "/signin" || url.pathname === "/premium" || url.pathname === "/musicpremium" || url.pathname === "/signin_prompt")
    ) &&
    !urlIsGoogleAccountsDomain(url)
  );
}

const createYTMView = (): void => {
  memoryStore.set("ytmViewLoadTimedout", false);
  memoryStore.set("ytmViewLoading", true);
  memoryStore.set("ytmViewLoadingError", false);
  memoryStore.set("ytmViewLoadingStatus", "Initializing...");

  ytmView = new BrowserView({
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      partition: app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev",
      preload: path.join(__dirname, `../renderer/windows/ytmview/preload.js`),
      // Gating autoplay on a user gesture makes YTM render its blocked-autoplay
      // hint and silently swallows every programmatic play, including restoring
      // the last track and following another player. Pause on launch is handled
      // by muting the restore and pausing once it reports playing instead.
      autoplayPolicy: "no-user-gesture-required",
      // The view is only attached to the window once its hooks are ready. A
      // detached view is treated as a background page and gets its timers
      // throttled, which stalls the hook polls it needs to become ready.
      backgroundThrottling: false,
      additionalArguments: isTestRun() ? ["--ytmd-test"] : []
    }
  });
  companionServer.provide(store, memoryStore, ytmView);
  ratioVolume.provide(ytmView);
  nonStop.provide(ytmView);
  providePlaybackView(() => ytmView);

  // Cosmetic filter injection queues a did-stop-loading waiter per scriptlet
  // while the page is still loading, which runs well past Node's default ceiling
  // of ten and logs a listener-leak warning at error level.
  ytmView.webContents.setMaxListeners(64);

  // Attach events to ytm view
  ytmView.webContents.on("will-navigate", event => {
    const url = new URL(event.url);
    if (isPreventedNavOrRedirect(url)) {
      event.preventDefault();
      log.info(`Blocking YTM View navigation to ${event.url}`);

      openExternalFromYtmView(event.url);
    }
  });
  ytmView.webContents.on("will-redirect", event => {
    const url = new URL(event.url);
    if (isPreventedNavOrRedirect(url)) {
      event.preventDefault();
      log.info(`Blocking YTM View redirect to ${event.url}`);
    }

    if (
      (url.hostname === "www.youtube.com" && url.pathname === "/premium") ||
      (url.hostname === "youtube.com" && url.pathname === "/premium") ||
      (url.hostname === "www.youtube.com" && url.pathname === "/musicpremium") ||
      (url.hostname === "youtube.com" && url.pathname === "/musicpremium")
    ) {
      // This users region requires a premium subscription to use YTM
      ytmView.webContents.loadURL(
        "https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26next%3Dhttps%253A%252F%252Fmusic.youtube.com%252F"
      );
    }
  });
  ytmView.webContents.on("did-navigate", ytmViewNavigated);
  ytmView.webContents.on("did-navigate-in-page", ytmViewNavigated);
  ytmView.webContents.on("enter-html-full-screen", () => {
    if (mainWindow) {
      mainWindow.setFullScreen(true);
    }
  });
  ytmView.webContents.on("leave-html-full-screen", () => {
    if (mainWindow) {
      mainWindow.setFullScreen(false);
    }
  });
  ytmView.webContents.on("render-process-gone", () => {
    store.set("state.lastUrl", lastUrl);
    store.set("state.lastVideoId", lastVideoId);
    store.set("state.lastPlaylistId", lastPlaylistId);
    createYTMView();
  });
  ytmView.webContents.on("page-title-updated", (_event, title) => {
    if (mainWindow) {
      mainWindow.setTitle(`${title} | YTMDesktop+`);
    }
  });
  ytmView.webContents.on("context-menu", (_event, params) => {
    if (store.get("developer.enableDevTools")) {
      Menu.buildFromTemplate([
        {
          label: "YouTube Music Desktop",
          type: "normal",
          enabled: false
        },
        {
          type: "separator"
        },
        {
          label: "Open Developer Tools",
          type: "normal",
          click: () => {
            if (ytmView) {
              ytmView.webContents.openDevTools({
                mode: "detach"
              });
            }
          }
        }
      ]).popup({
        window: mainWindow,
        x: params.x,
        y: params.y,
        sourceType: params.menuSourceType
      });
    }
  });
  ytmView.webContents.on("will-prevent-unload", event => {
    if (mainWindow) {
      if (!applicationQuitting) {
        if (ytmView.webContents.getURL().startsWith("https://music.youtube.com/")) {
          const choice = dialog.showMessageBoxSync(mainWindow, {
            type: "question",
            buttons: ["Leave", "Stay"],
            title: "Navigation",
            message: "YouTube Music is preventing navigation. Do you want to leave or stay?",
            defaultId: 0,
            cancelId: 1
          });

          if (choice !== 0) {
            return;
          }
        }
      }
    }

    event.preventDefault();
  });
  ytmView.webContents.on("unresponsive", () => {
    memoryStore.set("ytmViewUnresponsive", true);
  });
  ytmView.webContents.on("responsive", () => {
    memoryStore.set("ytmViewUnresponsive", false);
  });

  ytmView.webContents.setWindowOpenHandler(details => {
    openExternalFromYtmView(details.url);

    return {
      action: "deny"
    };
  });

  // Loading status event handlers
  ytmView.webContents.on("did-start-loading", () => {
    memoryStore.set("ytmViewLoadingStatus", "Loading YouTube Music...");
  });

  ytmView.webContents.on("did-stop-loading", () => {
    if (!memoryStore.get("ytmViewLoadingError")) {
      memoryStore.set("ytmViewLoadingStatus", "Loaded YouTube Music");
    }
  });

  ytmView.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (isMainFrame) {
      if (ytmViewLoadTimeout) clearTimeout(ytmViewLoadTimeout);

      memoryStore.set("ytmViewLoadingError", true);
      memoryStore.set("ytmViewLoadingStatus", `Failed to load YouTube Music: ${errorDescription} (${errorCode})`);
    }
  });

  memoryStore.set("ytmViewLoadingStatus", "Initialized");

  let navigateDefault = true;

  const continueWhereYouLeftOff: boolean = store.get("playback.continueWhereYouLeftOff");
  if (continueWhereYouLeftOff) {
    const lastUrl: string = store.get("state.lastUrl");
    if (lastUrl) {
      if (lastUrl.startsWith("https://music.youtube.com/")) {
        ytmView.webContents.loadURL(lastUrl);
        navigateDefault = false;
      }
    }
  }

  if (navigateDefault) {
    ytmView.webContents.loadURL("https://music.youtube.com/");
    store.set("state.lastUrl", "https://music.youtube.com/");
  }

  ytmViewLoadTimeout = setTimeout(() => {
    memoryStore.set("ytmViewLoadTimedout", true);
  }, 30 * 1000);
};

const createMainWindow = (): void => {
  // Create the browser window.
  const scaleFactor = screen.getPrimaryDisplay().scaleFactor;
  const windowBounds = store.get("state").windowBounds;
  mainWindow = createAppWindow({
    width: windowBounds?.width ?? 1280 / scaleFactor,
    height: windowBounds?.height ?? 720 / scaleFactor,
    x: windowBounds?.x,
    y: windowBounds?.y,
    minWidth: 156,
    minHeight: 180,
    show: false,
    icon: getIconPath("ytmd.png"),
    webPreferences: {
      preload: path.join(__dirname, `../renderer/windows/main/preload.js`),
      devTools: store.get("developer.enableDevTools")
    }
  });
  const windowMaximized = store.get("state").windowMaximized;
  // Even though bounds are set when creating the main window we set the bounds again to fix scaling issues. This is classified as an upstream chromium bug.
  if (windowBounds) {
    mainWindow.setBounds(windowBounds);
  }
  if (windowMaximized) {
    mainWindow.maximize();
  }

  // Attach events to main window
  mainWindow.on("resize", () => {
    setTimeout(() => {
      if (ytmView) {
        if (mainWindow.fullScreen) {
          ytmView.setBounds({
            x: 0,
            y: 0,
            width: mainWindow.getContentBounds().width,
            height: mainWindow.getContentBounds().height
          });
        } else {
          ytmView.setBounds({
            x: 0,
            y: 36,
            width: mainWindow.getContentBounds().width,
            height: mainWindow.getContentBounds().height - 36
          });
        }
      }
    });
  });

  mainWindow.on("enter-full-screen", () => {
    setTimeout(() => {
      if (ytmView) {
        ytmView.setBounds({
          x: 0,
          y: 0,
          width: mainWindow.getContentBounds().width,
          height: mainWindow.getContentBounds().height
        });
      }
    });
    sendMainWindowStateIpc();
  });
  mainWindow.on("leave-full-screen", () => {
    setTimeout(() => {
      ytmView.setBounds({
        x: 0,
        y: 36,
        width: mainWindow.getContentBounds().width,
        height: mainWindow.getContentBounds().height - 36
      });
    });
    sendMainWindowStateIpc();
  });
  mainWindow.on("maximize", sendMainWindowStateIpc);
  mainWindow.on("unmaximize", sendMainWindowStateIpc);
  mainWindow.on("minimize", sendMainWindowStateIpc);
  mainWindow.on("restore", sendMainWindowStateIpc);
  mainWindow.on("close", event => {
    if (!applicationQuitting && (store.get("general").hideToTrayOnClose || isDarwin)) {
      event.preventDefault();
      mainWindow.hide();
    }

    store.set("state.windowBounds", mainWindow.getNormalBounds());
    store.set("state.windowMaximized", mainWindow.isMaximized());
  });

  mainWindow.once("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
    // Open the DevTools.
    if (process.env.NODE_ENV === "development") {
      mainWindow.webContents.openDevTools({
        mode: "detach"
      });
    }
  });

  // and load the index.html of the app.
  loadWindowEntry(mainWindow, "main", ALL_WINDOWS_VITE_DEV_SERVER_URL);
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", async () => {
  log.info("Application ready");

  // First run checks
  const firstRunPath = path.join(app.getPath("userData"), ".first-run");
  try {
    await fs.access(firstRunPath, fs.constants.F_OK);
  } catch {
    // This is the first run of the program
    const firstRunTouch = await fs.open(firstRunPath, "a");
    await firstRunTouch.close();

    const v1ConfigPath = path.join(app.getPath("userData"), "..", "youtube-music-desktop-app", "config.json");
    try {
      const v1Config = JSON.parse(await fs.readFile(v1ConfigPath, { encoding: "utf-8" }));
      const migrateDialog = await dialog.showMessageBox({
        type: "question",
        message: "Would you like to migrate your settings?",
        detail:
          "A configuration file for YouTube Music Desktop App v1 was found. Your settings can be migrated.\n\nWARNING: Not all settings will be migrated as they may no longer be available in this version.",
        buttons: ["No", "Migrate Settings"]
      });

      if (migrateDialog.response === 1) {
        if ("settings-companion-server" in v1Config) {
          store.set("integrations.companionServerEnabled", v1Config["settings-companion-server"]);
        }

        if ("settings-continue-where-left-of" in v1Config) {
          store.set("playback.continueWhereYouLeftOff", v1Config["settings-continue-where-left-of"]);
        }

        if ("settings-custom-css-page" in v1Config) {
          if (v1Config["settings-custom-css-page"]) {
            const v1CustomCSSPath = path.join(app.getPath("userData"), "..", "youtube-music-desktop-app", "custom", "css", "page.css");
            const copyPath = path.join(app.getPath("userData"), "custom_css.css");
            await fs.copyFile(v1CustomCSSPath, copyPath);

            store.set("appearance.customCSSPath", copyPath);
            store.set("appearance.customCSSEnabled", true);
          }
        }

        if ("settings-decibel-volume" in v1Config) {
          store.set("playback.ratioVolume", v1Config["settings-decibel-volume"]);
        }

        if ("settings-discord-rich-presence" in v1Config) {
          store.set("integrations.discordPresenceEnabled", v1Config["settings-discord-rich-presence"]);
        }

        if ("settings-page-zoom" in v1Config) {
          store.set("appearance.zoom", v1Config["settings-page-zoom"]);
        }

        if ("settings-keep-background" in v1Config) {
          store.set("general.hideToTrayOnClose", v1Config["settings-keep-background"]);
        }

        if ("settings-show-notifications" in v1Config) {
          store.set("general.showNotificationOnSongChange", v1Config["settings-show-notifications"]);
        }

        if ("settings-start-minimized" in v1Config) {
          store.set("general.startMinimized", v1Config["settings-start-minimized"]);
        }

        if ("settings-start-on-boot" in v1Config) {
          store.set("general.startOnBoot", v1Config["settings-start-on-boot"]);
        }

        if ("settings-surround-sound" in v1Config) {
          store.set("playback.enableSpeakerFill", v1Config["settings-surround-sound"]);
        }

        if ("settings-accelerators" in v1Config) {
          if ("media-play-pause" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-play-pause"].toLowerCase() !== "disabled") {
              store.set("shortcuts.playPause", v1Config["settings-accelerators"]["media-play-pause"]);
            }
          }

          if ("media-track-next" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-track-next"].toLowerCase() !== "disabled") {
              store.set("shortcuts.next", v1Config["settings-accelerators"]["media-track-next"]);
            }
          }

          if ("media-track-previous" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-track-previous"].toLowerCase() !== "disabled") {
              store.set("shortcuts.previous", v1Config["settings-accelerators"]["media-track-previous"]);
            }
          }

          if ("media-track-like" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-track-like"].toLowerCase() !== "disabled") {
              store.set("shortcuts.thumbsUp", v1Config["settings-accelerators"]["media-track-like"]);
            }
          }

          if ("media-track-dislike" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-track-dislike"].toLowerCase() !== "disabled") {
              store.set("shortcuts.thumbsDown", v1Config["settings-accelerators"]["media-track-dislike"]);
            }
          }

          if ("media-volume-up" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-volume-up"].toLowerCase() !== "disabled") {
              store.set("shortcuts.volumeUp", v1Config["settings-accelerators"]["media-volume-up"]);
            }
          }

          if ("media-volume-down" in v1Config["settings-accelerators"]) {
            if (v1Config["settings-accelerators"]["media-volume-down"].toLowerCase() !== "disabled") {
              store.set("shortcuts.volumeDown", v1Config["settings-accelerators"]["media-volume-down"]);
            }
          }
        }

        if ("last-fm-login" in v1Config) {
          const usernameEmpty = v1Config["last-fm-login"]["username"] === null || v1Config["last-fm-login"]["username"].trim() === "";
          const passwordEmpty = v1Config["last-fm-login"]["password"] === null || v1Config["last-fm-login"]["password"].trim() === "";
          if (!usernameEmpty && !passwordEmpty) {
            store.set("integrations.lastFMEnabled", true);

            await dialog.showMessageBox({
              type: "info",
              message: "Last.fm",
              detail: "Last.fm configuration was found and has NOT been migrated. Re-authentication is required."
            });
          }
        }

        await dialog.showMessageBox({
          type: "info",
          message: "Settings migrated.",
          detail: "Your settings have been migrated."
        });
      }
    } catch {
      /* do nothing */
    }
  }

  if (!safeStorage.isEncryptionAvailable()) {
    memoryStore.set("safeStorageAvailable", false);
  } else {
    memoryStore.set("safeStorageAvailable", true);
  }

  const { isMainWindowSender, isSettingsSender, isYtmViewSender, isMemoryStoreSender } = createSenderGuards({
    getMainWindow: () => mainWindow,
    getSettingsWindow: () => settingsWindow,
    getYtmView: () => ytmView,
    ownsAddonContents: sender => addonManager.ownsWebContents(sender)
  });

  // Handle main window ipc
  ipcMain.on("mainWindow:minimize", event => {
    if (mainWindow !== null) {
      if (!isMainWindowSender(event.sender)) return;

      mainWindow.minimize();
    }
  });

  ipcMain.on("mainWindow:maximize", event => {
    if (mainWindow !== null) {
      if (!isMainWindowSender(event.sender)) return;

      mainWindow.maximize();
    }
  });

  ipcMain.on("mainWindow:restore", event => {
    if (mainWindow !== null) {
      if (!isMainWindowSender(event.sender)) return;

      mainWindow.restore();
    }
  });

  ipcMain.on("mainWindow:close", event => {
    if (mainWindow !== null) {
      if (!isMainWindowSender(event.sender)) return;

      if (store.get("general").hideToTrayOnClose || isDarwin) {
        mainWindow.hide();
      } else {
        app.quit();
      }
    }
  });

  ipcMain.on("mainWindow:requestWindowState", event => {
    if (!isMainWindowSender(event.sender)) return;

    sendMainWindowStateIpc();
  });

  // Handle settings window ipc
  ipcMain.on("settingsWindow:open", event => {
    if (!isMainWindowSender(event.sender)) return;

    createOrShowSettingsWindow();
  });

  ipcMain.on("settingsWindow:minimize", event => {
    if (settingsWindow !== null) {
      if (!isSettingsSender(event.sender)) return;

      settingsWindow.minimize();
    }
  });

  ipcMain.on("settingsWindow:maximize", event => {
    if (settingsWindow !== null) {
      if (!isSettingsSender(event.sender)) return;

      settingsWindow.maximize();
    }
  });

  ipcMain.on("settingsWindow:restore", event => {
    if (settingsWindow !== null) {
      if (!isSettingsSender(event.sender)) return;

      settingsWindow.restore();
    }
  });

  ipcMain.on("settingsWindow:close", event => {
    if (settingsWindow !== null) {
      if (!isSettingsSender(event.sender)) return;

      settingsWindow.close();
    }
  });

  ipcMain.on("settingsWindow:restartapplication", event => {
    if (!isSettingsSender(event.sender)) return;

    app.relaunch();
    app.quit();
  });

  // Handle ytm view ipc
  ipcMain.on("ytmView:loaded", event => {
    if (ytmView !== null && mainWindow !== null) {
      if (!isYtmViewSender(event.sender)) return;

      memoryStore.set("ytmViewLoading", false);
      clearTimeout(ytmViewLoadTimeout);
      mainWindow.addBrowserView(ytmView);
      ytmView.setBounds({
        x: 0,
        y: 36,
        width: mainWindow.getContentBounds().width,
        height: mainWindow.getContentBounds().height - 36
      });
      if (process.env.NODE_ENV === "development" && !isTestRun()) {
        ytmView.webContents.openDevTools({
          mode: "detach"
        });
      }

      // TODO: this is just a hack fix for ratio volume to run the enable script
      ratioVolume.ytmViewLoaded();
      nonStop.ytmViewLoaded();

      addonManager.notifyYtmViewLoaded();

      deepLinks.flushPending();
    }
  });

  if (YTMD_DEV_TOOLS) {
    const probeLogPath = path.join(app.getPath("userData"), "logs", "remote-probe.jsonl");
    ipcMain.on("ytmView:devProbeEnabled", event => {
      event.returnValue = remoteProbeActive && isYtmViewSender(event.sender);
    });
    ipcMain.on("ytmView:devProbe", async (event, batch: unknown[]) => {
      if (!remoteProbeActive || !isYtmViewSender(event.sender)) return;
      if (!Array.isArray(batch) || batch.length === 0) return;
      try {
        await fs.mkdir(path.dirname(probeLogPath), { recursive: true });
        await fs.appendFile(probeLogPath, batch.map(entry => JSON.stringify(entry)).join("\n") + "\n");
      } catch (error) {
        log.error("remote probe: failed to append", error);
      }
    });
  }

  ipcMain.on("ytmView:hookFailed", (event, stage, detail) => {
    if (!isYtmViewSender(event.sender)) return;

    clearTimeout(ytmViewLoadTimeout);
    log.error(`YTM view hook failed at stage '${stage}'`, detail);
    memoryStore.set("ytmViewLoadingError", true);
    memoryStore.set("ytmViewLoadingStatus", "YouTube Music loaded but could not be hooked. It may have changed in a way this app does not understand yet.");
  });

  // Optional setup modules degrade alone; the failure is recorded here so a
  // "feature X stopped working" report has the module name in the log.
  ipcMain.on("ytmView:optionalModuleFailed", (event, name, detail) => {
    if (!isYtmViewSender(event.sender)) return;

    log.warn(`YTM view optional module '${name}' failed`, detail);
  });

  ipcMain.on("ytmView:videoProgressChanged", (event, progress) => {
    if (!isYtmViewSender(event.sender)) return;

    playerStateStore.updateVideoProgress(progress);
  });

  ipcMain.on("ytmView:videoStateChanged", (event, state) => {
    if (!isYtmViewSender(event.sender)) return;

    // ytm state mapping definitions
    // -1 -> Unstarted
    // 1 -> Playing
    // 2 -> Paused
    // 3 -> Buffering
    // 5 -> Video Cued

    // ytm state flow
    // Play Button Click
    //   -1 -> 5 -> -1 -> 3 -> 1
    // First Play Button Click (Only happens when the player is first loaded)
    //   -1 -> 3 -> 1
    // Previous/Next Song Click
    //   -1 -> 5 -> -1 -> 5 -> -1 -> 3 -> 1

    playerStateStore.updateVideoState(state);
  });

  ipcMain.on("ytmView:videoDataChanged", (event, videoDetails, playlistId, album, likeStatus, hasFullMetadata) => {
    if (!isYtmViewSender(event.sender)) return;

    lastVideoId = videoDetails.videoId;
    lastPlaylistId = playlistId;

    playerStateStore.updateVideoDetails(videoDetails, playlistId, album, likeStatus, hasFullMetadata);
  });

  ipcMain.on("ytmView:storeStateChanged", (event, queue, likeStatus, volume, muted, adPlaying) => {
    if (!isYtmViewSender(event.sender)) return;

    playerStateStore.updateFromStore(queue, likeStatus, volume, muted, adPlaying);
  });

  ipcMain.on("ytmView:addonMessage", (event, addonId: string, name: string, payload: unknown) => {
    if (!isYtmViewSender(event.sender)) return;
    if (typeof addonId !== "string" || typeof name !== "string") return;

    addonManager.handleViewMessage(addonId, name, payload);
  });

  ipcMain.on("ytmView:launchPauseArmed", (event, videoId: string, wasMuted: boolean) => {
    if (!isYtmViewSender(event.sender)) return;
    if (typeof videoId !== "string" || videoId.length === 0) return;

    launchPause.arm(videoId, wasMuted === true).then(result => {
      log.info(`Launch pause for ${videoId}: ${result}`);
    });
  });

  ipcMain.on("ytmView:switchFocus", (event, context) => {
    if (!isYtmViewSender(event.sender) && !isMainWindowSender(event.sender)) return;

    if (context === "main") {
      if (mainWindow && ytmView.webContents.isFocused()) {
        mainWindow.webContents.focus();
      }
    } else if (context === "ytm") {
      if (ytmView && mainWindow.webContents.isFocused()) {
        ytmView.webContents.focus();
      }
    }
  });

  ipcMain.on("ytmView:navigateDefault", event => {
    if (ytmView) {
      if (!isMainWindowSender(event.sender)) return;

      ytmView.webContents.loadURL("https://music.youtube.com/");
    }
  });

  ipcMain.on("ytmView:recreate", event => {
    if (!isMainWindowSender(event.sender)) return;

    if (ytmView) {
      if (mainWindow) {
        mainWindow.removeBrowserView(ytmView);
      }

      cancelCue();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (ytmView.webContents as any).destroy();
      ytmView = null;
      createYTMView();
    }
  });

  ipcMain.handle("ytmView:getIntegrationScripts", event => {
    if (!isYtmViewSender(event.sender)) return;

    return ytmViewIntegrationScripts;
  });

  // Handle listen along ipc. Pairing runs entirely in the main process so the
  // host token never reaches a renderer.
  ipcMain.handle("listenAlong:pair", (event, host: string, port: number) => {
    if (!isSettingsSender(event.sender)) return false;

    listenAlong.provide(store, memoryStore);
    return listenAlong.startPairing(host, port);
  });

  ipcMain.on("listenAlong:unpair", event => {
    if (!isSettingsSender(event.sender)) return;

    listenAlong.unpair();
  });

  ipcMain.on("listenAlong:resume", event => {
    if (!isSettingsSender(event.sender)) return;

    listenAlong.resume();
  });

  // Handle memory store ipc
  ipcMain.on("memoryStore:set", (event, key: string, value?: unknown) => {
    if (!isMemoryStoreSender(event.sender)) return;

    memoryStore.set(key, value);
  });

  ipcMain.handle("memoryStore:get", (event, key: string) => {
    if (!isMemoryStoreSender(event.sender)) return;

    return memoryStore.get(key);
  });

  // Handle settings store ipc
  ipcMain.on("settings:set", (event, key: string, value?: unknown) => {
    if (!isSettingsSender(event.sender)) return;

    store.set(key, value);
  });

  ipcMain.on("settings:setMany", (event, entries: Array<[string, unknown]>) => {
    if (!isSettingsSender(event.sender)) return;
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      if (!Array.isArray(entry) || typeof entry[0] !== "string") continue;
      store.set(entry[0], entry[1]);
    }
  });

  ipcMain.handle("settings:get", (event, key: string) => {
    if (!isMainWindowSender(event.sender) && !isSettingsSender(event.sender) && !isYtmViewSender(event.sender) && !addonManager.ownsWebContents(event.sender))
      return;

    return store.get(key);
  });

  ipcMain.handle("settings:reset", (event, key: keyof StoreSchema) => {
    if (!isSettingsSender(event.sender)) return;

    store.reset(key);
  });

  // Handle addons ipc
  ipcMain.handle("addons:getAll", event => {
    if (!isMemoryStoreSender(event.sender)) return;

    return addonManager.descriptors();
  });

  ipcMain.handle("addons:setEnabled", async (event, id: string, enabled: boolean) => {
    if (!isSettingsSender(event.sender)) return;
    if (typeof id !== "string" || typeof enabled !== "boolean") return;

    if (enabled && addonManager.needsRiskAcknowledgement(id)) {
      const name = addonManager.descriptors().find(descriptor => descriptor.manifest.id === id)?.manifest.name ?? id;
      const result = await dialog.showMessageBox(settingsWindow, {
        type: "warning",
        title: "Enable external addon",
        message: `Enable ${name}?`,
        detail:
          "External addons run with the same access as the app itself: your files, your session and your accounts. Only enable addons from sources you trust.",
        buttons: ["Cancel", "Enable"],
        defaultId: 0,
        cancelId: 0
      });
      if (result.response !== 1) return;
      addonManager.acknowledgeRisk(id);
    }

    addonManager.setEnabled(id, enabled);
  });

  ipcMain.on("addons:badgeClick", (event, addonId: string) => {
    if (!isMemoryStoreSender(event.sender)) return;
    if (typeof addonId !== "string") return;

    addonManager.handleBadgeClick(addonId);
  });

  ipcMain.handle("addons:getRecentLog", async (event, id: string) => {
    if (!isSettingsSender(event.sender)) return [];
    if (typeof id !== "string") return [];

    try {
      const content = await fs.readFile(log.transports.file.getFile().path, "utf8");
      return filterLogTailForAddon(content, id).slice(-200);
    } catch {
      return [];
    }
  });

  ipcMain.on("addons:openHomepage", (event, id: string) => {
    if (!isSettingsSender(event.sender)) return;
    if (typeof id !== "string") return;

    // The url comes from the installed manifest, never from the renderer.
    const homepage = addonManager.descriptors().find(descriptor => descriptor.manifest.id === id)?.manifest.homepage;
    if (homepage && /^https?:\/\//.test(homepage)) shell.openExternal(homepage);
  });

  ipcMain.on("addons:invokeAction", (event, id: string, key: string) => {
    if (!isSettingsSender(event.sender)) return;
    if (typeof id !== "string" || typeof key !== "string") return;

    addonManager.handleSettingsAction(id, key);
  });

  ipcMain.on("addons:openFolder", async event => {
    if (!isSettingsSender(event.sender)) return;

    const addonsDir = path.join(app.getPath("userData"), "addons");
    await fs.mkdir(addonsDir, { recursive: true });
    shell.openPath(addonsDir);
  });

  // Handle safeStorage ipc
  ipcMain.handle("safeStorage:decryptString", (event, value: string) => {
    if (!memoryStore.get("safeStorageAvailable")) throw new Error("safeStorage is unavailable");
    if (!isSettingsSender(event.sender)) return;

    if (value) {
      return safeStorage.decryptString(Buffer.from(value, "hex"));
    } else {
      return null;
    }
  });

  ipcMain.handle("safeStorage:encryptString", (event, value: string) => {
    if (!memoryStore.get("safeStorageAvailable")) throw new Error("safeStorage is unavailable");
    if (!isSettingsSender(event.sender)) return;

    return safeStorage.encryptString(value).toString("hex");
  });

  // Handle app ipc
  ipcMain.handle("app:getVersion", event => {
    if (!isSettingsSender(event.sender)) return;

    return app.getVersion();
  });

  ipcMain.on("app:checkForUpdates", event => {
    if (!isSettingsSender(event.sender)) return;

    // autoUpdater downloads automatically and calling checkForUpdates causes duplicate install
    if (!appUpdateAvailable || !appUpdateDownloaded) {
      autoUpdater.checkForUpdates();
    }
  });

  ipcMain.handle("app:isUpdateAvailable", event => {
    if (!isSettingsSender(event.sender)) return;

    return appUpdateAvailable;
  });

  ipcMain.handle("app:isUpdateDownloaded", event => {
    if (!isSettingsSender(event.sender)) return;

    return appUpdateDownloaded;
  });

  ipcMain.on("app:restartApplicationForUpdate", event => {
    if (!isMainWindowSender(event.sender) && !isSettingsSender(event.sender)) return;

    // Electron explicitly will not call before-quit until after all the windows have closed, requiring us to have set that the application is quitting before hand
    applicationQuitting = true;
    autoUpdater.quitAndInstall();
  });

  log.info("Setup IPC handlers");

  // Create the permission handlers
  session.fromPartition(app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev").setPermissionCheckHandler((webContents, permission) => {
    if (webContents == ytmView.webContents) {
      if (permission === "fullscreen") {
        return true;
      }
    }

    return false;
  });
  session.fromPartition(app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev").setPermissionRequestHandler((webContents, permission, callback) => {
    if (webContents == ytmView.webContents) {
      if (permission === "fullscreen") {
        return callback(true);
      }
    }

    return callback(false);
  });

  log.info("Setup permission handlers");

  // Blocking is bound to the partition rather than the view, so it outlives a
  // view recreation. The engine is built off this path: the lists come over the
  // network and the app has to start without them.
  adBlocker.provide(
    session.fromPartition(app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev"),
    // The engine carries its own config, so a cache written under different
    // options is restored with those options. The name changes when they do.
    path.join(app.getPath("userData"), "adblocker-engine-network.bin")
  );
  if (store.get("playback").adBlockerEnabled) {
    adBlocker.enable();
  }

  // Register global shortcuts
  registerShortcuts();

  // Create the tray
  tray = new Tray(getTrayIconPath());
  tray.setToolTip("YouTube Music Desktop");
  tray.setContextMenu(Menu.buildFromTemplate(buildTrayContextMenu()));
  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      } else {
        mainWindow.show();
      }
    }
  });

  log.info("Created tray icon");

  const addonsDirPath = path.join(app.getPath("userData"), "addons");

  // The old appearance.customCSSPath setting becomes a styles-only addon
  const appearanceRaw = store.get("appearance") as unknown as Record<string, unknown>;
  if (appearanceRaw.customCSSPath !== undefined || appearanceRaw.customCSSEnabled !== undefined) {
    try {
      const migration = migrateCustomCssSetting(appearanceRaw, addonsDirPath);
      if (migration.migrated) {
        const addonsSection = store.get("addons");
        if (!addonsSection.states[migration.addonId]) {
          addonsSection.states[migration.addonId] = { enabled: migration.enabled, riskAcknowledged: true };
          store.set("addons", addonsSection);
        }
        log.info(`Custom CSS migrated to addon at ${migration.addonDir}`);
        new Notification({
          title: "Custom CSS is now an addon",
          body: "Your stylesheet moved into the addons folder. Manage it from Settings under Addons."
        }).show();
      }
    } catch (error) {
      log.error("Custom CSS migration failed", error);
    }
    store.delete("appearance.customCSSPath" as keyof StoreSchema);
    store.delete("appearance.customCSSEnabled" as keyof StoreSchema);
  }

  // The Listen Along rooms settings moved into the bundled rooms addon; the
  // old integration keys carry the user's choices over once.
  const integrationsRaw = store.get("integrations") as unknown as Record<string, unknown>;
  if (integrationsRaw.listenAlongRoomsEnabled !== undefined) {
    const addonsSection = store.get("addons");
    if (!addonsSection.states.rooms) {
      addonsSection.states.rooms = { enabled: integrationsRaw.listenAlongRoomsEnabled === true };
    }
    const roomsSettings = addonsSection.settings.rooms ?? {};
    if (roomsSettings.displayName === undefined) roomsSettings.displayName = integrationsRaw.listenAlongDisplayName ?? null;
    if (roomsSettings.audioStreamEnabled === undefined) roomsSettings.audioStreamEnabled = integrationsRaw.listenAlongAudioStreamEnabled !== false;
    if (roomsSettings.autoRoomEnabled === undefined) roomsSettings.autoRoomEnabled = integrationsRaw.listenAlongAutoRoomEnabled !== false;
    addonsSection.settings.rooms = roomsSettings;
    store.set("addons", addonsSection);
    store.delete("integrations.listenAlongRoomsEnabled" as keyof StoreSchema);
    store.delete("integrations.listenAlongDisplayName" as keyof StoreSchema);
    store.delete("integrations.listenAlongAudioStreamEnabled" as keyof StoreSchema);
    store.delete("integrations.listenAlongAutoRoomEnabled" as keyof StoreSchema);
  }

  const externalAddonScans = scanExternalAddons(addonsDirPath);
  addonManager.registerExternal(externalAddonScans);

  await addonManager.boot();
  log.info("Addons booted");

  // Edit-and-see loop for addon authors: YTMD_ADDON_DEV=1 reloads an external
  // addon after its files change. Development builds only; the user-facing
  // enable and disable model stays restart-scoped.
  if (process.env.YTMD_ADDON_DEV === "1" && !app.isPackaged) {
    watchExternalAddonsForDev(externalAddonScans, id => addonManager.reloadExternal(id), log);
    log.info("Addon dev reload is watching the addons directory");
  }

  createMainWindow();
  log.info("Created main window");

  memoryStore.set("ytmViewLoading", true);
  memoryStore.set("ytmViewLoadingStatus", "Checking for updates...");

  // Check for application updates
  if (updatesSupported()) {
    if (!store.get("updates").firstRunPromptShown) {
      const promptResult = await dialog.showMessageBox({
        type: "question",
        title: "Automatic updates",
        message: "Install updates automatically when the app starts?",
        detail: "You can change this at any time in Settings.",
        buttons: ["Enable automatic updates", "Not now"],
        defaultId: 0,
        cancelId: 1
      });
      store.set("updates.firstRunPromptShown", true);
      store.set("updates.autoUpdateEnabled", promptResult.response === 0);
    }

    if (store.get("updates").autoUpdateEnabled) {
      autoUpdater.checkForUpdates();
      await new Promise<void>(resolve => {
        setInterval(() => {
          if (!appLaunchUpdateCheck) resolve();
        }, 250);
      });
    } else {
      appLaunchUpdateCheck = false;
    }
  } else {
    appLaunchUpdateCheck = false;
  }

  // Integrations preflight initialization
  ytmViewIntegrationScripts["ratioVolume"] = ratioVolume.getYTMScripts().reduce<{ [name: string]: string }>((map, obj) => {
    map[obj.name] = obj.script;
    return map;
  }, {});
  ytmViewIntegrationScripts["nonStop"] = nonStop.getYTMScripts().reduce<{ [name: string]: string }>((map, obj) => {
    map[obj.name] = obj.script;
    return map;
  }, {});

  // Create the YouTube Music view
  createYTMView();
  log.info("Created YTM view");

  // Setup taskbar features
  setupTaskbarFeatures();
  log.info("Setup taskbar features");

  if (store.get("appearance").zoom) {
    log.info("Integration update: Zoom Factor");
    ytmView.webContents.setZoomFactor(store.get("appearance").zoom / 100);
  }

  // Integrations setup
  log.info("Starting enabled integrations");

  // NowPlayingNotifications
  if (store.get("general").showNotificationOnSongChange) {
    nowPlayingNotifications.enable();
    log.info("Integration enabled: Now playing notifications");
  }

  // RatioVolume
  if (store.get("playback").ratioVolume) {
    ratioVolume.provide(ytmView);
    ratioVolume.enable();
    log.info("Integration enabled: Ratio volume");
  }

  // NonStop
  if (store.get("playback").preventIdlePause) {
    nonStop.provide(ytmView);
    nonStop.enable();
    log.info("Integration enabled: Prevent idle pause");
  }

  // CompanionServer
  if (store.get("integrations").companionServerEnabled) {
    companionServer.provide(store, memoryStore, ytmView);
    companionServer.enable();
    log.info("Integration enabled: Companion server");
  }

  // DiscordPresence
  if (store.get("integrations").discordPresenceEnabled) {
    discordPresence.provide(store, memoryStore);
    discordPresence.enable();
    log.info("Integration enabled: Discord presence");
  }

  // LastFM
  if (store.get("integrations").lastFMEnabled) {
    lastFMScrobbler.provide(store, memoryStore);
    lastFMScrobbler.enable();
    log.info("Integration enabled: Last.fm");
  }

  // Listen along
  if (store.get("integrations").listenAlongEnabled) {
    listenAlong.provide(store, memoryStore);
    listenAlong.enable();
    log.info("Integration enabled: Listen along");
  }

  nativeTheme.on("updated", setTrayIcon);
});

// Addon destroy() work is async; quit is held back until it settles, capped
// so a hung addon can never wedge the app in limbo.
let addonShutdownSettled = false;
app.on("before-quit", event => {
  log.info("Application quitting\n\n");
  applicationQuitting = true;
  cancelCue();
  saveState();
  if (!addonShutdownSettled) {
    event.preventDefault();
    const finish = () => {
      addonShutdownSettled = true;
      app.quit();
    };
    Promise.race([addonManager.shutdown(), new Promise(resolve => setTimeout(resolve, 3000))]).then(finish, finish);
  }
});

app.on("open-url", (_, url) => {
  deepLinks.handleProtocol(url);
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (!isDarwin) {
    app.quit();
  }
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
    createYTMView();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
