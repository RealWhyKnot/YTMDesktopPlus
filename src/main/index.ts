import {
  app,
  autoUpdater,
  WebContentsView,
  BrowserWindow,
  crashReporter,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  net,
  protocol,
  shell,
} from "electron";
import log from "electron-log";
import path from "path";
import "crypto";
import "fs/promises";
import electronSquirrelStartup from "electron-squirrel-startup";

import { MemoryStore } from "./memory-store";
import { AddonManager } from "./addons/manager";
import "./addons/external-loader";
import "./addons/dev-reload";
import "./addons/log-tail";
import "./addons/migrate-custom-css";
import { BUNDLED_ADDONS } from "../addons/bundled";
import { playerStateStore } from "./player-state-store";
import { setLogOutputEnabled, setupLogging } from "./logging";
import { instrumentIpc, stallTasks, watchMainThreadStalls } from "./stall-watch";
import { type MemoryStoreSchema } from "../shared/store/schema";

import { CompanionServer } from "./integrations/companion-server";
import { watchCompanionAuthWindow } from "./integrations/companion-server/auth-window-timer";
import { DiscordPresence } from "./integrations/discord-presence";
import { LastFM } from "./integrations/last-fm";
import { NowPlayingNotifications } from "./integrations/notifications";
import { VolumeRatio } from "./integrations/volume-ratio";
import { NonStop } from "./integrations/nonstop";
import { AdBlocker } from "./integrations/ad-blocker";
import { ListenAlong } from "./integrations/listen-along";
import { initializeTestSeams, isTestClient } from "./test-seams";
import { migrateLegacyProfile } from "./profile-migration";
import { sendPlaybackCommand } from "./playback";
import { createLaunchPause } from "./playback/launch-pause";
import "./ipc/sender-guards";
import { canOpenExternally } from "./ytm-navigation";
import "./ipc/ytm-view-payloads";
import "./windows/window-factory";
import { ThemeManager } from "./themes/manager";
import "./ipc/themes";

import { createAppStore } from "./store/create-store";
import { createStoreBroadcaster } from "./windows/broadcast";
import "./windows/coalesce";
import "./windows/launch-visibility";
import "./deep-links";
import { createShortcutRegistrar } from "./shortcuts";
import { createTrayController } from "./tray";
import "./taskbar";
import { type IntegrationRegistration } from "./integrations/lifecycle";
import "./ipc/window-controls";
import "./ipc/store-bridge";
import { buildUpdateFeedUrl, newerVersionFromFeed } from "../shared/update-feed";
import { MEDIA_SCHEME, MEDIA_SCHEME_PRIVILEGES } from "./media/media-host";
import { showSettingsWindow } from "./startup/settings-window";
import { createYtmView } from "./startup/ytm-view";
import { openMainWindow } from "./startup/main-window";
import { createAddonHost } from "./startup/addon-host";
import { installErrorHandler } from "./startup/errors";
import "./startup/migrate-v1-settings";
import "./startup/ipc";
import "./startup/themes";
import { watchSettings } from "./startup/settings-sync";
import { installUpdateEvents } from "./startup/update-events";
import { canSelfUpdate, canShowUpdateNotice, type UpdateClient } from "./startup/update-eligibility";
import "./startup/addons-and-updates";
import { initializeProtocol } from "./startup/protocol";
import { installLifecycle } from "./startup/lifecycle";
import { createIntegrationRegistrations } from "./startup/integrations";

function createMainContext() {
  return {
    get sendRemoteCommand() {
      return sendRemoteCommand;
    },
    get getControlsIconPath() {
      return getControlsIconPath;
    },
    get nowPlayingNotifications() {
      return nowPlayingNotifications;
    },
    get lastFMScrobbler() {
      return lastFMScrobbler;
    },
    get isAppLaunchUpdateCheck() {
      return isAppLaunchUpdateCheck;
    },
    set isAppLaunchUpdateCheck(isValue: typeof isAppLaunchUpdateCheck) {
      isAppLaunchUpdateCheck = isValue;
    },
    get createMainWindow() {
      return createMainWindow;
    },
    get mainWindow() {
      return mainWindow;
    },
    set mainWindow(value: typeof mainWindow) {
      mainWindow = value;
    },
    get settingsWindow() {
      return settingsWindow;
    },
    set settingsWindow(value: typeof settingsWindow) {
      settingsWindow = value;
    },
    get getIconPath() {
      return getIconPath;
    },
    get isDarwin() {
      return isDarwin;
    },
    get store() {
      return store;
    },
    get sendSettingsWindowStateIpc() {
      return sendSettingsWindowStateIpc;
    },
    get isApplicationQuitting() {
      return isApplicationQuitting;
    },
    set isApplicationQuitting(isValue: typeof isApplicationQuitting) {
      isApplicationQuitting = isValue;
    },
    get requireSettingsWindow() {
      return requireSettingsWindow;
    },
    get allWindowsViteDevServerUrl() {
      return ALL_WINDOWS_VITE_DEV_SERVER_URL;
    },
    get memoryStore() {
      return memoryStore;
    },
    get ytmView() {
      return ytmView;
    },
    set ytmView(value: typeof ytmView) {
      ytmView = value;
    },
    get companionServer() {
      return companionServer;
    },
    get ratioVolume() {
      return ratioVolume;
    },
    get nonStop() {
      return nonStop;
    },
    get adBlocker() {
      return adBlocker;
    },
    get openExternalFromYtmView() {
      return openExternalFromYtmView;
    },
    get requireYtmView() {
      return requireYtmView;
    },
    get ytmViewNavigated() {
      return ytmViewNavigated;
    },
    get saveState() {
      return saveState;
    },
    get createYTMView() {
      return createYTMView;
    },
    get requireMainWindow() {
      return requireMainWindow;
    },
    get ytmViewLoadTimeout() {
      return ytmViewLoadTimeout;
    },
    set ytmViewLoadTimeout(value: typeof ytmViewLoadTimeout) {
      ytmViewLoadTimeout = value;
    },
    get sendMainWindowStateIpc() {
      return sendMainWindowStateIpc;
    },
    get trayController() {
      return trayController;
    },
    get ytmViewIntegrationScripts() {
      return ytmViewIntegrationScripts;
    },
    get isAddonManagerCreated() {
      return isAddonManagerCreated;
    },
    set isAddonManagerCreated(isValue: typeof isAddonManagerCreated) {
      isAddonManagerCreated = isValue;
    },
    get addonManager() {
      return addonManager;
    },
    get discordPresence() {
      return discordPresence;
    },
    get deepLinks() {
      return deepLinks;
    },
    get themeManager() {
      return themeManager;
    },
    set themeManager(value: typeof themeManager) {
      themeManager = value;
    },
    get isApplicationExited() {
      return isApplicationExited;
    },
    set isApplicationExited(isValue: typeof isApplicationExited) {
      isApplicationExited = isValue;
    },
    get stateSaverInterval() {
      return stateSaverInterval;
    },
    set stateSaverInterval(value: typeof stateSaverInterval) {
      stateSaverInterval = value;
    },
    get createOrShowSettingsWindow() {
      return createOrShowSettingsWindow;
    },
    get isYtmdDevTools() {
      return isYtmdDevTools;
    },
    get isRemoteProbeActive() {
      return isRemoteProbeActive;
    },
    get lastVideoId() {
      return lastVideoId;
    },
    set lastVideoId(value: typeof lastVideoId) {
      lastVideoId = value;
    },
    get lastPlaylistId() {
      return lastPlaylistId;
    },
    set lastPlaylistId(value: typeof lastPlaylistId) {
      lastPlaylistId = value;
    },
    get launchPause() {
      return launchPause;
    },
    get listenAlong() {
      return listenAlong;
    },
    get isAppUpdateAvailable() {
      return isAppUpdateAvailable;
    },
    set isAppUpdateAvailable(isValue: typeof isAppUpdateAvailable) {
      isAppUpdateAvailable = isValue;
    },
    get isAppUpdateDownloaded() {
      return isAppUpdateDownloaded;
    },
    set isAppUpdateDownloaded(isValue: typeof isAppUpdateDownloaded) {
      isAppUpdateDownloaded = isValue;
    },
    get requireThemeManager() {
      return requireThemeManager;
    },
    get broadcastToWindows() {
      return broadcastToWindows;
    },
    get isAppliedStartOnBoot() {
      return isAppliedStartOnBoot;
    },
    set isAppliedStartOnBoot(isValue: typeof isAppliedStartOnBoot) {
      isAppliedStartOnBoot = isValue;
    },
    get integrationRegistrations() {
      return integrationRegistrations;
    },
    get applyDebugLogging() {
      return applyDebugLogging;
    },
    get updatesSupported() {
      return updatesSupported;
    },
    get applyUpdateFeed() {
      return applyUpdateFeed;
    },
    get isChannelSwitchInstall() {
      return isChannelSwitchInstall;
    },
    set isChannelSwitchInstall(isValue: typeof isChannelSwitchInstall) {
      isChannelSwitchInstall = isValue;
    },
    get registerShortcuts() {
      return registerShortcuts;
    },
  };
}
export type MainContext = ReturnType<typeof createMainContext>;
const mainContext = createMainContext();

declare const ALL_WINDOWS_VITE_DEV_SERVER_URL: string;

declare const isYtmdDisableUpdates: boolean;
declare const isYtmdLocalBuild: boolean;
declare const isYtmdDevTools: boolean;

const isRemoteProbeActive = isYtmdDevTools && process.env.YTMD_REMOTE_PROBE === "1";

instrumentIpc(ipcMain, stallTasks.timeSync);

initializeTestSeams();
const isMigratedLegacyProfile = migrateLegacyProfile();

const assetFolder = path.join(process.env.NODE_ENV === "development" ? path.join(app.getAppPath(), "src/assets") : process.resourcesPath);
const isDarwin = process.platform === "darwin";

let isApplicationExited = false;
let isApplicationQuitting = false;
let isAppUpdateAvailable = false;
let isAppUpdateDownloaded = false;
let isAppLaunchUpdateCheck = true;

let stateSaverInterval: NodeJS.Timeout | null = null;

crashReporter.start({ uploadToServer: false });

setupLogging(app.isPackaged);
if (isMigratedLegacyProfile) {
  log.info("Migrated settings and session data from the previous installation");
}

installErrorHandler(mainContext);
log.eventLogger.startLogging();

Object.assign(console, log.functions);

if (electronSquirrelStartup) {
  app.quit();
}

log.info("Application launched");
watchMainThreadStalls({
  tasks: stallTasks,
  report: (blockedMs, summary) => log.warn(`Main thread blocked for ${blockedMs}ms (${summary})`),
});

app.enableSandbox();

protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: MEDIA_SCHEME_PRIVILEGES }]);

const template: MenuItemConstructorOptions[] = [{ role: "appMenu", label: "YTMDesktop+" }, { role: "editMenu" }];
const builtMenu = isDarwin ? Menu.buildFromTemplate(template) : null;
Menu.setApplicationMenu(builtMenu);

const companionServer = new CompanionServer();
const discordPresence = new DiscordPresence();
const lastFMScrobbler = new LastFM();
const listenAlong = new ListenAlong();
const nowPlayingNotifications = new NowPlayingNotifications();
const ratioVolume = new VolumeRatio();
const nonStop = new NonStop();
const adBlocker = new AdBlocker();

const ytmViewIntegrationScripts = new Map<string, Map<string, string>>();

let mainWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let ytmView: WebContentsView | null = null;
let themeManager: ThemeManager | null = null;

function requireMainWindow(): BrowserWindow {
  if (mainWindow === null) throw new Error("Main window is unavailable");
  return mainWindow;
}

function requireSettingsWindow(): BrowserWindow {
  if (settingsWindow === null) throw new Error("Settings window is unavailable");
  return settingsWindow;
}

function requireYtmView(): WebContentsView {
  if (ytmView === null) throw new Error("YouTube Music view is unavailable");
  return ytmView;
}

function requireThemeManager(): ThemeManager {
  if (themeManager === null) throw new Error("Theme manager is unavailable");
  return themeManager;
}

let lastUrl = "";
let lastVideoId = "";
let lastPlaylistId: string | null | undefined = "";

let ytmViewLoadTimeout: NodeJS.Timeout | null = null;

const deepLinks = initializeProtocol(mainContext);

let isAddonManagerCreated = false;
const memoryStore = new MemoryStore<MemoryStoreSchema>();
const broadcastToWindows = createStoreBroadcaster({
  getMainWindow: () => mainWindow,
  getSettingsWindow: () => settingsWindow,
  getYtmView: () => ytmView,
  addonWebContents: () => (isAddonManagerCreated ? addonManager.windowWebContents() : []),
});

memoryStore.onStateChanged((key, value) => {
  broadcastToWindows("memoryStore:stateChanged", { includeMainWindow: true }, key, value);
});
watchCompanionAuthWindow(memoryStore, () => store.get("integrations").companionServerEnabled);
log.info("Created memory store");

const launchPause = createLaunchPause({
  addEventListener: (listener) => playerStateStore.addEventListener(listener),
  removeEventListener: (listener) => playerStateStore.removeEventListener(listener),
  send: (command) => sendPlaybackCommand(command),
});

function updateClient(): UpdateClient {
  return {
    isPackaged: app.isPackaged,
    platform: process.platform,
    isLocalBuild: isYtmdLocalBuild,
    isUpdatesDisabled: isYtmdDisableUpdates,
    isTestClient: isTestClient(),
  };
}

function updatesSupported() {
  return canSelfUpdate(updateClient());
}

function updateNoticeSupported() {
  return canShowUpdateNotice(updateClient());
}

async function checkUpdateNotice() {
  try {
    const response = await net.fetch(buildUpdateFeedUrl(store.get("updates").channel, app.getVersion(), process.platform, process.arch));
    if (!response.ok) return;
    const latest = newerVersionFromFeed(await response.json(), app.getVersion());
    if (latest === null) return;
    log.info(`Application update available: ${latest}`);
    memoryStore.set("appUpdateLatestVersion", latest);
    memoryStore.set("appUpdateAvailable", true);
  } catch (error) {
    log.error(error);
  }
}

let isChannelSwitchInstall = false;

installUpdateEvents(mainContext);

function getIconPath(icon: string) {
  return path.join(assetFolder, `${process.env.NODE_ENV === "development" ? "icons/" : ""}${icon}`);
}
function getControlsIconPath(icon: string) {
  return getIconPath(`${process.env.NODE_ENV === "development" ? "controls/" : ""}${icon}`);
}

const store = createAppStore();

const applyDebugLogging = () => setLogOutputEnabled(!app.isPackaged || store.get("developer").debugLogging);
applyDebugLogging();

const addonManager: AddonManager = createAddonHost(mainContext);
addonManager.registerBundled(BUNDLED_ADDONS);
isAddonManagerCreated = true;

const applyUpdateFeed = () =>
  autoUpdater.setFeedURL({
    url: buildUpdateFeedUrl(store.get("updates").channel, app.getVersion(), process.platform, process.arch),
  });

if (updatesSupported()) {
  applyUpdateFeed();
  setInterval(
    () => {
      if (store.get("updates").autoUpdateEnabled) autoUpdater.checkForUpdates();
    },
    1000 * 60 * 15
  );
} else if (updateNoticeSupported()) {
  void app
    .whenReady()
    .then(() => {
      void checkUpdateNotice().catch((error: unknown) => log.warn("Update check failed", error));
      setInterval(
        () => {
          void checkUpdateNotice().catch((error: unknown) => log.warn("Update check failed", error));
        },
        1000 * 60 * 60
      );
    })
    .catch((error: unknown) => log.warn("index: operation failed", error));
}

const integrationRegistrations: IntegrationRegistration[] = createIntegrationRegistrations(mainContext);

let isAppliedStartOnBoot: boolean | undefined;

watchSettings(mainContext);
log.info("Created electron store");

if (store.get("general").disableHardwareAcceleration) {
  app.disableHardwareAcceleration();
}

if (store.get("playback").enableSpeakerFill) {
  app.commandLine.appendSwitch("try-supported-channel-layouts");
}

function saveState() {
  stallTasks.timeSync("saveState", () => {
    store.set("state", { ...store.get("state"), lastUrl, lastVideoId, lastPlaylistId });
  });
}

stateSaverInterval = setInterval(
  () => {
    saveState();
  },
  5 * 60 * 1000
);

const sendRemoteCommand = (command: string) => {
  if (ytmView) {
    ytmView.webContents.send("remoteControl:execute", command);
  }
};

const registerShortcuts = createShortcutRegistrar({ store, memoryStore, sendRemoteCommand });

const trayController = createTrayController({
  store,
  getMainWindow: () => mainWindow,
  sendRemoteCommand,
  addonTrayItems: () => addonManager.trayMenuItems(),
});

function sendMainWindowStateIpc() {
  if (mainWindow !== null) {
    mainWindow.webContents.send("mainWindow:stateChanged", {
      minimized: mainWindow.isMinimized(),
      maximized: mainWindow.isMaximized(),
      fullscreen: mainWindow.isFullScreen(),
    });
  }
}

function ytmViewNavigated() {
  if (ytmView !== null) {
    const url = ytmView.webContents.getURL();
    if (url.startsWith("https://music.youtube.com/")) {
      lastUrl = url;
      ytmView.webContents.send("ytmView:navigationStateChanged", {
        canGoBack: ytmView.webContents.navigationHistory.canGoBack(),
        canGoForward: ytmView.webContents.navigationHistory.canGoForward(),
      });
    }
  }
}

function sendSettingsWindowStateIpc() {
  if (settingsWindow !== null) {
    settingsWindow.webContents.send("settingsWindow:stateChanged", {
      minimized: settingsWindow.isMinimized(),
      maximized: settingsWindow.isMaximized(),
    });
  }
}

function openExternalFromYtmView(urlString: string) {
  if (canOpenExternally(urlString)) {
    void shell.openExternal(urlString).catch((error: unknown) => log.warn("openExternalFromYtmView failed", error));
  }
}

const createOrShowSettingsWindow = (): void => {
  showSettingsWindow(mainContext);
};

const createYTMView = (): void => {
  createYtmView(mainContext);
};

const createMainWindow = (): void => {
  openMainWindow(mainContext);
};

installLifecycle(mainContext);
