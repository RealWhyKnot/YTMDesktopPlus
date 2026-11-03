import log from "electron-log";
import { app } from "electron";
import type { StoreSchema } from "../../shared/store/schema";
import { createStoreDefaults } from "../../shared/store/defaults.mts";
import { NUMERIC_SETTING_KEYS, normalizeSettingValue } from "~shared/settings-staging";
import { isRecord } from "~shared/unknown";
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

function fillMissingFields(store: CachedConf<MigratingStoreSchema>, defaults: StoreSchema) {
  for (const [section, fields] of Object.entries(defaults)) {
    const stored: unknown = store.get(section);
    if (!isRecord(stored)) continue;
    for (const [field, value] of Object.entries<unknown>(fields)) {
      if (stored[field] === undefined) store.set(`${section}.${field}`, value);
    }
  }
}

function restoreNumbers(store: CachedConf<MigratingStoreSchema>) {
  for (const key of NUMERIC_SETTING_KEYS) {
    const value: unknown = store.get(key);
    const normalized = normalizeSettingValue(key, value);
    if (typeof value === "string" && typeof normalized === "number") store.set(key, normalized);
  }
}

export function createAppStore(): CachedConf<MigratingStoreSchema> {
  const defaults = createStoreDefaults(app.getVersion());
  const store = new CachedConf<MigratingStoreSchema>({
    configName: "config",
    cwd: app.getPath("userData"),
    projectVersion: app.getVersion(),
    watch: true,
    defaults,
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

  const playback: Partial<MigratingStoreSchema["playback"]> = store.get("playback");
  const integrations: Partial<StoreSchema["integrations"]> = store.get("integrations");

  if (playback.loudnessNormalization !== undefined) {
    store.delete("playback.loudnessNormalization");
  }
  if (integrations.companionServerLANEnabled === undefined) {
    store.set("integrations.companionServerLANEnabled", integrations.companionServerEnabled);
  }
  fillMissingFields(store, defaults);

  const addons: Partial<StoreSchema["addons"]> = store.get("addons");
  if (addons.states?.dj !== undefined) {
    store.delete("addons.states.dj");
  }
  if (addons.settings?.dj !== undefined) {
    store.delete("addons.settings.dj");
  }
  restoreNumbers(store);

  return store;
}
