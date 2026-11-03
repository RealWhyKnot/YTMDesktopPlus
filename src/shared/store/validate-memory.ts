import type { MemoryStoreSchema } from "./schema";
import { isRecord } from "../unknown";
import { isAddonDescriptor, isAddonTitlebarBadge } from "../addons/validate-descriptor";
import { isThemeDescriptor } from "../themes/validate-descriptor";
import { arrayOf, isBoolean, isString, nullable, recordOf, type GuardMap } from "../validation";

export const memoryGuards: GuardMap<MemoryStoreSchema> = {
  addonsRuntime: arrayOf(isAddonDescriptor),
  themesRuntime: arrayOf(isThemeDescriptor),
  addonMemory: recordOf(isRecord),
  addonTitlebarBadges: arrayOf(isAddonTitlebarBadge),
  discordPresenceConnectionFailed: isBoolean,
  listenAlongStatus: (value): value is MemoryStoreSchema["listenAlongStatus"] =>
    isString(value) && ["disabled", "pairing", "connecting", "connected", "loading", "synced", "suspended", "failed"].includes(value),
  listenAlongStatusDetail: nullable(isString),
  listenAlongPairingCode: nullable(isString),
  listenAlongPairingError: nullable(isString),
  shortcutsPlayPauseRegisterFailed: isBoolean,
  shortcutsNextRegisterFailed: isBoolean,
  shortcutsPreviousRegisterFailed: isBoolean,
  shortcutsThumbsUpRegisterFailed: isBoolean,
  shortcutsThumbsDownRegisterFailed: isBoolean,
  shortcutsVolumeUpRegisterFailed: isBoolean,
  shortcutsVolumeDownRegisterFailed: isBoolean,
  companionServerAuthWindowEnabled: isBoolean,
  safeStorageAvailable: isBoolean,
  autoUpdaterDisabled: isBoolean,
  ytmViewLoadTimedout: isBoolean,
  ytmViewLoading: isBoolean,
  ytmViewLoadingError: isBoolean,
  ytmViewLoadingStatus: isString,
  ytmViewUnresponsive: isBoolean,
  appUpdateAvailable: isBoolean,
  appUpdateDownloaded: isBoolean,
  appUpdateLatestVersion: isString,
};
