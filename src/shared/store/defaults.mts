import type { StoreSchema } from "./schema.ts";

const DEFAULT_SHORTCUTS = {
  playPause: "",
  next: "",
  previous: "",
  thumbsUp: "",
  thumbsDown: "",
  volumeUp: "",
  volumeDown: "",
};

export function createStoreDefaults(version: string): StoreSchema {
  return {
    metadata: {
      version: 1,
    },
    general: {
      disableHardwareAcceleration: false,
      hideToTrayOnClose: false,
      showNotificationOnSongChange: false,
      startOnBoot: false,
      startMinimized: false,
    },
    appearance: {
      alwaysShowVolumeSlider: false,
      zoom: 100,
      trayIconStyle: 0,
    },
    playback: {
      continueWhereYouLeftOff: true,
      continueWhereYouLeftOffPaused: true,
      enableSpeakerFill: false,
      progressInTaskbar: false,
      ratioVolume: false,
      adBlockerEnabled: false,
      preventIdlePause: false,
    },
    integrations: {
      companionServerEnabled: false,
      companionServerAuthTokens: null,
      companionServerCORSWildcardEnabled: false,
      companionServerLANEnabled: false,
      discordPresenceEnabled: false,
      discordPresenceHideOnPause: true,
      lastFMEnabled: false,
      listenAlongEnabled: false,
      listenAlongHost: null,
      listenAlongHostPort: 9863,
      listenAlongToken: null,
    },
    shortcuts: {
      ...DEFAULT_SHORTCUTS,
    },
    state: {
      lastUrl: "https://music.youtube.com/",
      lastPlaylistId: "",
      lastVideoId: "",
      windowBounds: null,
      windowMaximized: false,
    },
    lastfm: {
      api_key: "2a69bcf769a7a28a8bf2f6a5100accad",
      secret: "46eea23770a459a49eb4d26cbf46b41c",
      token: null,
      sessionKey: null,
      scrobblePercent: 50,
    },
    developer: {
      enableDevTools: false,

      debugLogging: version.includes("-beta"),
    },
    updates: {
      autoUpdateEnabled: false,
      channel: 0,
      firstRunPromptShown: false,
    },
    addons: {
      states: {},
      settings: {},
    },
    themes: {
      active: null,
    },
  };
}
