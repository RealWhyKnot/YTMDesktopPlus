import { attachYtmView, detachYtmView } from "../windows/ytm-view-lifecycle";
import { app, autoUpdater, dialog, ipcMain, safeStorage, session, shell } from "electron";
import log from "electron-log";
import path from "path";

import fs from "fs/promises";

import { filterLogTailForAddon } from "../addons/log-tail";
import { serializeYtmScripts } from "../addons/script-table";

import { playerStateStore } from "../player-state-store";

import { blockWatchHistoryWrites, isTestRun } from "../test-seams";

import { cancelCue } from "../playback";

import { appWindowPermissionAllowed, createSenderGuards } from "../ipc/sender-guards";
import { YTM_ORIGIN, YTM_SIGN_IN_ORIGINS } from "../ytm-navigation";
import {
  createPayloadRejectLog,
  isAlbumPayload,
  isFiniteNumber,
  isOptionalString,
  isQueuePayload,
  isOptionalNumber,
  isOptionalBoolean,
  isVideoDetailsPayload,
} from "../ipc/ytm-view-payloads";

import { registerWindowControlIpc } from "../ipc/window-controls";
import { registerStoreBridgeIpc } from "../ipc/store-bridge";

import { MEDIA_SCHEME, mediaHost, serveMediaScheme } from "../media/media-host";
import type { MainContext } from "../index";

export function installApplicationIpc(context: MainContext) {
  const { isMainWindowSender, isSettingsSender, isYtmViewSender, isYtmViewPage, isMemoryStoreSender } = createSenderGuards({
    getMainWindow: () => context.mainWindow,
    getSettingsWindow: () => context.settingsWindow,
    getYtmView: () => context.ytmView,
    ownsAddonContents: (sender) => context.addonManager.ownsWebContents(sender),
  });

  registerWindowControlIpc(ipcMain, {
    getMainWindow: () => context.mainWindow,
    getSettingsWindow: () => context.settingsWindow,
    isMainWindowSender,
    isSettingsSender,
    hideMainWindowOnClose: () => context.store.get("general").hideToTrayOnClose || context.isDarwin,
    quitApp: () => app.quit(),
    relaunchApp: () => {
      app.relaunch();
      app.quit();
    },
    sendMainWindowState: context.sendMainWindowStateIpc,
    openSettingsWindow: context.createOrShowSettingsWindow,
  });

  const rejectYtmViewPayload = createPayloadRejectLog((message) => log.warn(message));
  const ytmViewLoadedOrigins = [YTM_ORIGIN, ...YTM_SIGN_IN_ORIGINS];

  ipcMain.on("ytmView:loaded", (event) => {
    if (context.ytmView !== null && context.mainWindow !== null) {
      if (!isYtmViewPage(event, ytmViewLoadedOrigins)) return;

      context.memoryStore.set("ytmViewLoading", false);
      if (context.ytmViewLoadTimeout !== null) clearTimeout(context.ytmViewLoadTimeout);
      log.info("YTM view loaded");
      attachYtmView(context.mainWindow, context.ytmView);
      context.ytmView.setBounds({
        x: 0,
        y: 36,
        width: context.mainWindow.getContentBounds().width,
        height: context.mainWindow.getContentBounds().height - 36,
      });
      if (process.env.NODE_ENV === "development" && !isTestRun()) {
        context.ytmView.webContents.openDevTools({
          mode: "detach",
        });
      }

      context.ratioVolume.ytmViewLoaded();
      context.nonStop.ytmViewLoaded();
      context.adBlocker.ytmViewLoaded();

      context.addonManager.notifyYtmViewLoaded();

      context.deepLinks.flushPending();
    }
  });

  if (context.isYtmdDevTools) {
    const probeLogPath = path.join(app.getPath("userData"), "logs", "remote-probe.jsonl");
    ipcMain.on("ytmView:devProbeEnabled", (event) => {
      event.returnValue = context.isRemoteProbeActive && isYtmViewPage(event);
    });
    const recordProbe = async (event: Electron.IpcMainEvent, batch: unknown) => {
      if (!context.isRemoteProbeActive || !isYtmViewPage(event)) return;
      if (!Array.isArray(batch) || batch.length === 0) return;
      try {
        await fs.mkdir(path.dirname(probeLogPath), { recursive: true });
        await fs.appendFile(probeLogPath, batch.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
      } catch (error) {
        log.error("remote probe: failed to append", error);
      }
    };
    ipcMain.on("ytmView:devProbe", (event, batch: unknown) => {
      void recordProbe(event, batch).catch((error: unknown) => log.error("remote probe: failed to append", error));
    });
  }

  ipcMain.on("ytmView:adBlockEnabled", (event) => {
    event.returnValue = isYtmViewSender(event.sender) && context.store.get("playback").adBlockerEnabled;
  });

  ipcMain.on("ytmView:adBlockEvent", (event, kind: unknown, detail: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (typeof kind !== "string") {
      rejectYtmViewPayload("ytmView:adBlockEvent");
      return;
    }

    const detailText = String(detail);
    log.info(detail === undefined || detail === null ? `Ad blocker: ${kind}` : `Ad blocker: ${kind} ${detailText}`);
  });

  ipcMain.on("ytmView:hookFailed", (event, stage: unknown, detail: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (typeof stage !== "string") {
      rejectYtmViewPayload("ytmView:hookFailed");
      return;
    }

    if (context.ytmViewLoadTimeout !== null) clearTimeout(context.ytmViewLoadTimeout);
    log.error(`YTM view hook failed at stage '${stage}'`, detail);
    context.memoryStore.set("ytmViewLoadingError", true);
    context.memoryStore.set(
      "ytmViewLoadingStatus",
      "YouTube Music loaded but could not be hooked. It may have changed in a way this app does not understand yet."
    );
  });

  ipcMain.on("ytmView:optionalModuleFailed", (event, name: unknown, detail: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (typeof name !== "string") {
      rejectYtmViewPayload("ytmView:optionalModuleFailed");
      return;
    }

    log.warn(`YTM view optional module '${name}' failed`, detail);
  });

  ipcMain.on("ytmView:contractMiss", (event, what: unknown, detail: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (typeof what !== "string") {
      rejectYtmViewPayload("ytmView:contractMiss");
      return;
    }

    log.warn(`YTM contract miss: ${what}`, detail);
  });

  ipcMain.on("ytmView:videoProgressChanged", (event, progress: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (!isFiniteNumber(progress)) {
      rejectYtmViewPayload("ytmView:videoProgressChanged");
      return;
    }

    playerStateStore.updateVideoProgress(progress);
  });

  ipcMain.on("ytmView:videoStateChanged", (event, state: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (!isFiniteNumber(state)) {
      rejectYtmViewPayload("ytmView:videoStateChanged");
      return;
    }

    playerStateStore.updateVideoState(state);
  });

  ipcMain.on("ytmView:videoDataChanged", (event, videoDetails: unknown, playlistId: unknown, album: unknown, likeStatus: unknown, hasFullMetadata: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (
      !isVideoDetailsPayload(videoDetails) ||
      !isOptionalString(playlistId) ||
      !isAlbumPayload(album) ||
      !isOptionalString(likeStatus) ||
      (hasFullMetadata !== undefined && typeof hasFullMetadata !== "boolean")
    ) {
      rejectYtmViewPayload("ytmView:videoDataChanged");
      return;
    }

    context.lastVideoId = videoDetails.videoId;
    context.lastPlaylistId = playlistId;

    playerStateStore.updateVideoDetails(videoDetails, playlistId, album ?? null, likeStatus, hasFullMetadata === true);
  });

  ipcMain.on("ytmView:queueChanged", (event, queue: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (!isQueuePayload(queue)) {
      rejectYtmViewPayload("ytmView:queueChanged");
      return;
    }

    playerStateStore.updateQueue(queue);
  });

  ipcMain.on("ytmView:storeStateChanged", (event, likeStatus: unknown, volume: unknown, muted: unknown, adPlaying: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (!isOptionalString(likeStatus) || !isOptionalNumber(volume) || !isOptionalBoolean(muted) || !isOptionalBoolean(adPlaying)) {
      rejectYtmViewPayload("ytmView:storeStateChanged");
      return;
    }

    playerStateStore.updateFromStore(likeStatus, volume, muted, adPlaying);
  });

  ipcMain.on("ytmView:roomCapturePort", (event) => {
    const port = event.ports[0];
    if (!port) return;
    if (!isYtmViewPage(event)) {
      port.close();
      return;
    }

    mediaHost.acceptPagePort(port);
  });

  ipcMain.on("ytmView:addonMessage", (event, addonId: unknown, name: unknown, payload: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (typeof addonId !== "string" || typeof name !== "string") return;

    context.addonManager.handleViewMessage(addonId, name, payload);
  });

  ipcMain.on("ytmView:launchPauseArmed", (event, videoId: unknown, wasMuted: unknown) => {
    if (!isYtmViewPage(event)) return;
    if (typeof videoId !== "string" || videoId.length === 0 || typeof wasMuted !== "boolean") return;

    void context.launchPause
      .arm(videoId, wasMuted)
      .then((result) => {
        log.info(`Launch pause for ${videoId}: ${result}`);
      })
      .catch((error: unknown) => log.warn("installApplicationIpc failed", error));
  });

  ipcMain.on("ytmView:switchFocus", (event, target: unknown) => {
    if (!isYtmViewPage(event) && !isMainWindowSender(event.sender)) return;

    if (target === "main") {
      if (context.mainWindow && context.ytmView?.webContents.isFocused()) {
        context.mainWindow.webContents.focus();
      }
    } else if (target === "ytm") {
      if (context.ytmView && context.mainWindow?.webContents.isFocused()) {
        context.ytmView.webContents.focus();
      }
    }
  });

  ipcMain.on("ytmView:navigateDefault", (event) => {
    if (context.ytmView) {
      if (!isMainWindowSender(event.sender)) return;

      void context.ytmView.webContents.loadURL("https://music.youtube.com/").catch((error: unknown) => log.warn("installApplicationIpc failed", error));
    }
  });

  ipcMain.on("ytmView:recreate", (event) => {
    if (!isMainWindowSender(event.sender)) return;

    if (context.ytmView) {
      if (context.mainWindow) {
        detachYtmView(context.mainWindow, context.ytmView);
      }

      cancelCue();

      const contents = context.ytmView.webContents;
      const destroy: unknown = Reflect.get(contents, "destroy");
      if (typeof destroy !== "function") throw new TypeError("Web contents cannot be destroyed");
      Reflect.apply(destroy, contents, []);
      context.ytmView = null;
      context.createYTMView();
    }
  });

  ipcMain.handle("ytmView:getIntegrationScripts", (event) => {
    if (!isYtmViewPage(event)) return;

    return serializeYtmScripts(context.ytmViewIntegrationScripts);
  });

  ipcMain.handle("listenAlong:pair", (event, host: unknown, port: unknown) => {
    if (!isSettingsSender(event.sender)) return false;
    if (typeof host !== "string" || !isFiniteNumber(port)) return false;

    context.listenAlong.provide(context.store, context.memoryStore);
    return context.listenAlong.startPairing(host, port);
  });

  ipcMain.on("listenAlong:unpair", (event) => {
    if (!isSettingsSender(event.sender)) return;

    context.listenAlong.unpair();
  });

  ipcMain.on("listenAlong:resume", (event) => {
    if (!isSettingsSender(event.sender)) return;

    context.listenAlong.resume();
  });

  registerStoreBridgeIpc(ipcMain, {
    store: context.store,
    memoryStore: context.memoryStore,
    isMemoryStoreSender,
    isSettingsSender,
    isSettingsReader: (event) =>
      isMainWindowSender(event.sender) ||
      isSettingsSender(event.sender) ||
      isYtmViewPage(event, ytmViewLoadedOrigins) ||
      context.addonManager.ownsWebContents(event.sender),
    decryptString: (value) => safeStorage.decryptString(Buffer.from(value, "hex")),
    encryptString: (value) => safeStorage.encryptString(value).toString("hex"),
  });

  ipcMain.handle("addons:getAll", (event) => {
    if (!isMemoryStoreSender(event.sender)) return;

    return context.addonManager.descriptors();
  });

  ipcMain.handle("addons:setEnabled", async (event, id: unknown, isEnabled: unknown) => {
    if (!isSettingsSender(event.sender)) return;
    if (typeof id !== "string" || typeof isEnabled !== "boolean") return;

    if (isEnabled && context.addonManager.needsRiskAcknowledgement(id)) {
      const name = context.addonManager.descriptors().find((descriptor) => descriptor.manifest.id === id)?.manifest.name ?? id;
      const result = await dialog.showMessageBox(context.requireSettingsWindow(), {
        type: "warning",
        title: "Enable external addon",
        message: `Enable ${name}?`,
        detail:
          "External addons run with the same access as the app itself: your files, your session and your accounts. Only enable addons from sources you trust.",
        buttons: ["Cancel", "Enable"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response !== 1) return;
      context.addonManager.acknowledgeRisk(id);
    }

    context.addonManager.setEnabled(id, isEnabled);
  });

  ipcMain.on("addons:badgeClick", (event, addonId: unknown) => {
    if (!isMemoryStoreSender(event.sender)) return;
    if (typeof addonId !== "string") return;

    context.addonManager.handleBadgeClick(addonId);
  });

  ipcMain.handle("addons:getRecentLog", async (event, id: unknown) => {
    if (!isSettingsSender(event.sender)) return [];
    if (typeof id !== "string") return [];

    try {
      const content = await fs.readFile(log.transports.file.getFile().path, "utf8");
      return filterLogTailForAddon(content, id).slice(-200);
    } catch {
      return [];
    }
  });

  ipcMain.on("addons:openHomepage", (event, id: unknown) => {
    if (!isSettingsSender(event.sender)) return;
    if (typeof id !== "string") return;

    const homepage = context.addonManager.descriptors().find((descriptor) => descriptor.manifest.id === id)?.manifest.homepage;
    if (homepage && /^https?:\/\//.test(homepage)) void shell.openExternal(homepage).catch((error: unknown) => log.warn("installApplicationIpc failed", error));
  });

  const addonsDirPath = path.join(app.getPath("userData"), "addons");

  ipcMain.on("addons:invokeAction", (event, id: unknown, key: unknown) => {
    if (!isSettingsSender(event.sender)) return;
    if (typeof id !== "string" || typeof key !== "string") return;

    context.addonManager.handleSettingsAction(id, key);
  });

  const openAddonsFolder = async (event: Electron.IpcMainEvent) => {
    if (!isSettingsSender(event.sender)) return;

    await fs.mkdir(addonsDirPath, { recursive: true });
    void shell.openPath(addonsDirPath).catch((error: unknown) => log.warn("installApplicationIpc failed", error));
  };
  ipcMain.on("addons:openFolder", (event) => {
    void openAddonsFolder(event).catch((error: unknown) => log.warn("Could not open the addons folder", error));
  });

  ipcMain.handle("app:getVersion", (event) => {
    if (!isSettingsSender(event.sender)) return;

    return app.getVersion();
  });

  ipcMain.on("app:checkForUpdates", (event) => {
    if (!isSettingsSender(event.sender)) return;

    if (!context.isAppUpdateAvailable || !context.isAppUpdateDownloaded) {
      autoUpdater.checkForUpdates();
    }
  });

  ipcMain.handle("app:isUpdateAvailable", (event) => {
    if (!isSettingsSender(event.sender)) return;

    return context.isAppUpdateAvailable;
  });

  ipcMain.handle("app:isUpdateDownloaded", (event) => {
    if (!isSettingsSender(event.sender)) return;

    return context.isAppUpdateDownloaded;
  });

  ipcMain.on("app:restartApplicationForUpdate", (event) => {
    if (!isMainWindowSender(event.sender) && !isSettingsSender(event.sender)) return;

    context.isApplicationQuitting = true;
    autoUpdater.quitAndInstall();
  });

  log.info("Setup IPC handlers");

  session.fromPartition(app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev").setPermissionCheckHandler((webContents, permission) => {
    if (webContents !== null && isYtmViewSender(webContents)) {
      if (permission === "fullscreen") {
        return true;
      }
    }

    return false;
  });
  session.fromPartition(app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev").setPermissionRequestHandler((webContents, permission, callback) => {
    if (isYtmViewSender(webContents)) {
      if (permission === "fullscreen") {
        callback(true);
        return;
      }
    }

    callback(false);
  });

  const appWindowPermissionDeps = { isSettingsSender, ownsAddonContents: (sender: Electron.WebContents) => context.addonManager.ownsWebContents(sender) };
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => appWindowPermissionAllowed(appWindowPermissionDeps, webContents, permission));
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) =>
    callback(appWindowPermissionAllowed(appWindowPermissionDeps, webContents, permission))
  );

  session.fromPartition(app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev").protocol.handle(MEDIA_SCHEME, serveMediaScheme);
  blockWatchHistoryWrites(session.fromPartition(app.isPackaged ? "persist:ytmview" : "persist:ytmview-dev"));

  log.info("Setup permission handlers");

  return { isSettingsSender, addonsDirPath };
}
