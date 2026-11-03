import type { AddonDescriptor, AddonTitlebarBadge } from "~shared/addons/sdk";
import type { ThemeDescriptor } from "../themes/sdk";

export const TrayIconStyle = {
  Auto: 0,
  [0]: "Auto",
  White: 1,
  [1]: "White",
  Black: 2,
  [2]: "Black",
} as const;
export type TrayIconStyle = (typeof TrayIconStyle)[Exclude<keyof typeof TrayIconStyle, number>];

export const UpdateChannel = {
  Auto: 0,
  [0]: "Auto",
  Stable: 1,
  [1]: "Stable",
  Beta: 2,
  [2]: "Beta",
} as const;
export type UpdateChannel = (typeof UpdateChannel)[Exclude<keyof typeof UpdateChannel, number>];

export type StoreSchema = {
  metadata: {
    version: 1;
  };
  general: {
    disableHardwareAcceleration: boolean;
    hideToTrayOnClose: boolean;
    showNotificationOnSongChange: boolean;
    startOnBoot: boolean;
    startMinimized: boolean;
  };
  appearance: {
    alwaysShowVolumeSlider: boolean;
    zoom: number;
    trayIconStyle: TrayIconStyle;
  };
  playback: {
    continueWhereYouLeftOff: boolean;
    continueWhereYouLeftOffPaused: boolean;
    enableSpeakerFill: boolean;
    progressInTaskbar: boolean;
    ratioVolume: boolean;
    adBlockerEnabled: boolean;
    preventIdlePause: boolean;
  };
  integrations: {
    companionServerEnabled: boolean;
    companionServerAuthTokens: string | null;
    companionServerCORSWildcardEnabled: boolean;
    companionServerLANEnabled: boolean;
    discordPresenceEnabled: boolean;
    discordPresenceHideOnPause: boolean;
    lastFMEnabled: boolean;
    listenAlongEnabled: boolean;
    listenAlongHost: string | null;
    listenAlongHostPort: number;
    listenAlongToken: string | null;
  };
  shortcuts: {
    playPause: string;
    next: string;
    previous: string;
    thumbsUp: string;
    thumbsDown: string;
    volumeUp: string;
    volumeDown: string;
  };
  state: {
    lastUrl: string;
    lastPlaylistId: string | null | undefined;
    lastVideoId: string;
    windowBounds: Electron.Rectangle | null;
    windowMaximized: boolean;
  };
  lastfm: {
    api_key: string;
    secret: string;
    token: string | null;
    sessionKey: string | null;
    scrobblePercent: number;
  };
  developer: {
    enableDevTools: boolean;
    debugLogging: boolean;
  };
  updates: {
    autoUpdateEnabled: boolean;
    channel: UpdateChannel;
    firstRunPromptShown: boolean;
  };
  addons: {
    states: Record<string, { enabled: boolean; riskAcknowledged?: boolean; fingerprint?: string } | undefined>;
    settings: Record<string, Record<string, unknown>>;
  };
  themes: {
    active: string | null;
  };
};

export type ListenAlongStatus = "disabled" | "pairing" | "connecting" | "connected" | "loading" | "synced" | "suspended" | "failed";

export type MemoryStoreSchema = {
  addonsRuntime: AddonDescriptor[];
  themesRuntime: ThemeDescriptor[];
  addonMemory: Record<string, Record<string, unknown>>;
  addonTitlebarBadges: AddonTitlebarBadge[];
  discordPresenceConnectionFailed: boolean;
  listenAlongStatus: ListenAlongStatus;
  listenAlongStatusDetail: string | null;
  listenAlongPairingCode: string | null;
  listenAlongPairingError: string | null;
  shortcutsPlayPauseRegisterFailed: boolean;
  shortcutsNextRegisterFailed: boolean;
  shortcutsPreviousRegisterFailed: boolean;
  shortcutsThumbsUpRegisterFailed: boolean;
  shortcutsThumbsDownRegisterFailed: boolean;
  shortcutsVolumeUpRegisterFailed: boolean;
  shortcutsVolumeDownRegisterFailed: boolean;
  companionServerAuthWindowEnabled: boolean;
  safeStorageAvailable: boolean;
  autoUpdaterDisabled: boolean;
  ytmViewLoadTimedout: boolean;
  ytmViewLoading: boolean;
  ytmViewLoadingError: boolean;
  ytmViewLoadingStatus: string;
  ytmViewUnresponsive: boolean;
  appUpdateAvailable: boolean;
  appUpdateDownloaded: boolean;
  appUpdateLatestVersion: string;
};
