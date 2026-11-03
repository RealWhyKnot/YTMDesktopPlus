import log from "electron-log";
import { app } from "electron";
import { type StoreSchema, UpdateChannel } from "../../shared/store/schema";
import { createStoreDefaults } from "../../shared/store/defaults.mts";
import { CachedConf } from "./cached-conf";

type MigratingStoreSchema = Omit<StoreSchema, "appearance" | "playback" | "integrations" | "state"> & {
  appearance: StoreSchema["appearance"] & { customCSSPath?: unknown; customCSSEnabled?: unknown };
  playback: StoreSchema["playback"] & { loudnessNormalization?: unknown };
  integrations: StoreSchema["integrations"] & {
    companionServerAuthWindowEnabled?: unknown;
    listenAlongRoomsEnabled?: unknown;
    listenAlongDisplayName?: unknown;
    listenAlongAudioStreamEnabled?: unknown;
    listenAlongAutoRoomEnabled?: unknown;
  };
  state: StoreSchema["state"] & { companionServerAuthWindowEnableTime?: unknown };
};

export function createAppStore(): CachedConf<MigratingStoreSchema> {
  const store = new CachedConf<MigratingStoreSchema>({
    configName: "config",
    cwd: app.getPath("userData"),
    projectVersion: app.getVersion(),
    watch: true,
    defaults: createStoreDefaults(app.getVersion()),
    beforeEachMigration: (_store, context) => {
      log.info(`Performing store migration from ${context.fromVersion} to ${context.toVersion}`);
    },
    migrations: {
      ">=2.0.0": (store) => {
        store.delete("integrations.companionServerAuthWindowEnabled");

        store.delete("state.companionServerAuthWindowEnableTime");
        if (!store.has("appearance.zoom")) {
          store.set("appearance.zoom", 100);
        }
      },
      ">=2.0.1": (store) => {
        if (!store.has("lastfm.scrobblePercent")) {
          store.set("lastfm.scrobblePercent", 50);
        }
      },
      ">=2.0.7": (store) => {
        if (!store.has("appearance.trayIconStyle")) {
          store.set("appearance.trayIconStyle", 0);
        }
      },
    },
  });

  const developer: Partial<StoreSchema["developer"]> = store.get("developer");
  const playback: Partial<MigratingStoreSchema["playback"]> = store.get("playback");
  const integrations: Partial<StoreSchema["integrations"]> = store.get("integrations");
  const updates: unknown = store.get("updates");
  const savedAddons: unknown = store.get("addons");
  const themes: unknown = store.get("themes");

  if (developer.debugLogging === undefined) {
    store.set("developer.debugLogging", app.getVersion().includes("-beta"));
  }
  if (updates === undefined) {
    store.set("updates", { autoUpdateEnabled: false, channel: UpdateChannel.Auto, firstRunPromptShown: false });
  }
  if (playback.adBlockerEnabled === undefined) {
    store.set("playback.adBlockerEnabled", false);
  }

  if (playback.loudnessNormalization !== undefined) {
    store.delete("playback.loudnessNormalization");
  }
  if (playback.preventIdlePause === undefined) {
    store.set("playback.preventIdlePause", false);
  }
  if (integrations.discordPresenceHideOnPause === undefined) {
    store.set("integrations.discordPresenceHideOnPause", true);
  }
  if (integrations.companionServerLANEnabled === undefined) {
    store.set("integrations.companionServerLANEnabled", integrations.companionServerEnabled);
  }
  if (savedAddons === undefined) {
    store.set("addons", { states: {}, settings: {} });
  }
  const addons: Partial<StoreSchema["addons"]> = store.get("addons");
  if (addons.states === undefined) {
    store.set("addons.states", {});
  }
  if (addons.settings === undefined) {
    store.set("addons.settings", {});
  }
  if (addons.states?.dj !== undefined) {
    store.delete("addons.states.dj");
  }
  if (addons.settings?.dj !== undefined) {
    store.delete("addons.settings.dj");
  }
  if (themes === undefined) {
    store.set("themes", { active: null });
  }

  return store;
}
