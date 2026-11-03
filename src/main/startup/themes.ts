import { app, BrowserWindow, dialog, ipcMain, Notification, shell } from "electron";
import log from "electron-log";
import path from "path";

import fs from "fs/promises";

import { migrateCustomCssSetting } from "../addons/migrate-custom-css";

import { refreshTitleBarOverlays, setTitleBarOverlayProvider } from "../windows/window-factory";
import { ThemeManager } from "../themes/manager";
import { registerThemeIpc } from "../ipc/themes";
import type { ThemeCss } from "~shared/themes/sdk";

import type { MainContext } from "../index";

export async function initializeThemes(
  context: MainContext,
  addonsDirPath: string,
  isSettingsSender: (sender: Electron.WebContents) => boolean
): Promise<void> {
  const appearanceRaw = context.store.get("appearance");
  if (appearanceRaw.customCSSPath !== undefined || appearanceRaw.customCSSEnabled !== undefined) {
    try {
      const migration = migrateCustomCssSetting(appearanceRaw, addonsDirPath);
      if (migration.migrated) {
        const addonsSection = context.store.get("addons");
        if (!addonsSection.states[migration.addonId]) {
          addonsSection.states[migration.addonId] = { enabled: migration.enabled, riskAcknowledged: true };
          context.store.set("addons", addonsSection);
        }
        log.info(`Custom CSS migrated to addon at ${migration.addonDir}`);
        new Notification({
          title: "Custom CSS is now an addon",
          body: "Your stylesheet moved into the addons folder. Manage it from Settings under Addons.",
        }).show();
      }
    } catch (error) {
      log.error("Custom CSS migration failed", error);
    }
    context.store.delete("appearance.customCSSPath");
    context.store.delete("appearance.customCSSEnabled");
  }

  const integrationsRaw = context.store.get("integrations");
  if (integrationsRaw.listenAlongRoomsEnabled !== undefined) {
    const addonsSection = context.store.get("addons");
    addonsSection.states.rooms ??= { enabled: integrationsRaw.listenAlongRoomsEnabled === true };
    const roomsSettings = addonsSection.settings.rooms ?? {};
    if (roomsSettings.displayName === undefined) roomsSettings.displayName = integrationsRaw.listenAlongDisplayName ?? null;
    if (roomsSettings.audioStreamEnabled === undefined) roomsSettings.audioStreamEnabled = integrationsRaw.listenAlongAudioStreamEnabled !== false;
    if (roomsSettings.autoRoomEnabled === undefined) roomsSettings.autoRoomEnabled = integrationsRaw.listenAlongAutoRoomEnabled !== false;
    addonsSection.settings.rooms = roomsSettings;
    context.store.set("addons", addonsSection);
    context.store.delete("integrations.listenAlongRoomsEnabled");
    context.store.delete("integrations.listenAlongDisplayName");
    context.store.delete("integrations.listenAlongAudioStreamEnabled");
    context.store.delete("integrations.listenAlongAutoRoomEnabled");
  }

  const bundledThemesDirPath = process.env.NODE_ENV === "development" ? path.join(app.getAppPath(), "src/themes") : path.join(process.resourcesPath, "themes");
  const userThemesDirPath = path.join(app.getPath("userData"), "themes");
  await fs.mkdir(userThemesDirPath, { recursive: true });

  const broadcastTheme = (css: ThemeCss) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send("themes:changed", css);
    }
    context.ytmView?.webContents.send("themes:changed", css);
    refreshTitleBarOverlays();
  };

  context.themeManager = new ThemeManager({
    bundledThemesDir: bundledThemesDirPath,
    userThemesDir: userThemesDirPath,
    appVersion: app.getVersion(),
    getActiveId: () => context.store.get("themes").active,
    setActiveId: (id) => context.store.set("themes", { active: id }),
    onChanged: (css) => {
      broadcastTheme(css);
      context.memoryStore.set("themesRuntime", context.requireThemeManager().descriptors());
    },
    log,
    watchBundled: !app.isPackaged,
  });

  setTitleBarOverlayProvider(() => context.requireThemeManager().titleBarOverlay());
  context.themeManager.refresh();
  log.info(`Themes loaded (${context.themeManager.descriptors().length} available, active: ${context.themeManager.activeTheme().id ?? "none"})`);

  registerThemeIpc(ipcMain, {
    descriptors: () => context.requireThemeManager().descriptors(),
    getCss: () => context.requireThemeManager().getCss(),
    rescan: () => context.requireThemeManager().refresh(),
    setActive: (id) => context.requireThemeManager().setActive(id),
    create: () => context.requireThemeManager().createNew(),
    duplicate: (id) => context.requireThemeManager().duplicate(id),
    exportTo: (id, destination) => context.requireThemeManager().exportTo(id, destination),
    install: (zipPath) => context.requireThemeManager().install(zipPath),
    openThemesFolder: () => {
      void shell.openPath(userThemesDirPath).catch((error: unknown) => log.warn("Could not open the themes folder", error));
    },
    revealPath: (target) => {
      void shell.openPath(target).catch((error: unknown) => log.warn("Could not reveal the theme file", error));
    },
    pickArchive: async () => {
      const result = await dialog.showOpenDialog({
        title: "Install a theme",
        filters: [{ name: "Theme archive", extensions: ["zip"] }],
        properties: ["openFile"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
    pickExportDestination: async (suggestedName) => {
      const result = await dialog.showSaveDialog({
        title: "Export theme",
        defaultPath: suggestedName,
        filters: [{ name: "Theme archive", extensions: ["zip"] }],
      });
      return result.canceled || !result.filePath ? null : result.filePath;
    },
    isSettingsSender,
  });

  const retiredAddonDataPath = path.join(app.getPath("userData"), "addon-data", "dj");
  if (
    await fs.rm(retiredAddonDataPath, { recursive: true }).then(
      () => true,
      () => false
    )
  ) {
    log.info("Removed data left by the retired dj addon");
  }
}
