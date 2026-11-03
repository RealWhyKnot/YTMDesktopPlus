import type { StoreSchema } from "./schema";
import { isRecord } from "../unknown";
import { arrayOf, isBoolean, isNumber, isString, nullable, objectOf, optional, recordOf, type GuardMap } from "../validation";

export const storeGuards: GuardMap<StoreSchema> = {
  metadata: objectOf({ version: (value): value is 1 => value === 1 }),
  general: objectOf({
    disableHardwareAcceleration: isBoolean,
    hideToTrayOnClose: isBoolean,
    showNotificationOnSongChange: isBoolean,
    startOnBoot: isBoolean,
    startMinimized: isBoolean,
  }),
  appearance: objectOf({
    alwaysShowVolumeSlider: isBoolean,
    zoom: isNumber,
    trayIconStyle: (value): value is 0 | 1 | 2 => value === 0 || value === 1 || value === 2,
  }),
  playback: objectOf({
    continueWhereYouLeftOff: isBoolean,
    continueWhereYouLeftOffPaused: isBoolean,
    enableSpeakerFill: isBoolean,
    progressInTaskbar: isBoolean,
    ratioVolume: isBoolean,
    adBlockerEnabled: isBoolean,
    preventIdlePause: isBoolean,
  }),
  integrations: objectOf({
    companionServerEnabled: isBoolean,
    companionServerAuthTokens: nullable(isString),
    companionServerCORSWildcardEnabled: isBoolean,
    companionServerLANEnabled: isBoolean,
    discordPresenceEnabled: isBoolean,
    discordPresenceHideOnPause: isBoolean,
    lastFMEnabled: isBoolean,
    listenAlongEnabled: isBoolean,
    listenAlongHost: nullable(isString),
    listenAlongHostPort: isNumber,
    listenAlongToken: nullable(isString),
  }),
  shortcuts: objectOf({
    playPause: isString,
    next: isString,
    previous: isString,
    thumbsUp: isString,
    thumbsDown: isString,
    volumeUp: isString,
    volumeDown: isString,
  }),
  state: objectOf({
    lastUrl: isString,
    lastPlaylistId: optional(nullable(isString)),
    lastVideoId: isString,
    windowBounds: nullable(objectOf({ x: isNumber, y: isNumber, width: isNumber, height: isNumber })),
    windowMaximized: isBoolean,
  }),
  lastfm: objectOf({ api_key: isString, secret: isString, token: nullable(isString), sessionKey: nullable(isString), scrobblePercent: isNumber }),
  developer: objectOf({ enableDevTools: isBoolean, debugLogging: isBoolean }),
  updates: objectOf({
    autoUpdateEnabled: isBoolean,
    channel: (value): value is 0 | 1 | 2 => value === 0 || value === 1 || value === 2,
    firstRunPromptShown: isBoolean,
  }),
  addons: objectOf({
    states: recordOf(objectOf({ enabled: isBoolean, riskAcknowledged: optional(isBoolean), fingerprint: optional(isString) })),
    settings: recordOf(isRecord),
  }),
  themes: objectOf({ active: nullable(isString) }),
};

export const isStoreSchema = objectOf(storeGuards);
export const isStringArray = arrayOf(isString);
