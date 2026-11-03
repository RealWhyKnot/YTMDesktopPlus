import type { AddonDescriptor, AddonSettingsField } from "~shared/addons/sdk";

export function settingsState(overrides: Record<string, Record<string, unknown>> = {}): Record<string, Record<string, unknown>> {
  const state = new Map<string, Record<string, unknown>>(
    Object.entries({
      general: {
        hideToTrayOnClose: true,
        showNotificationOnSongChange: false,
        startOnBoot: false,
        startMinimized: false,
        disableHardwareAcceleration: false,
      },
      developer: { debugLogging: false, enableDevTools: false },
      appearance: { alwaysShowVolumeSlider: false, zoom: 100, trayIconStyle: 0 },
      playback: {
        continueWhereYouLeftOff: true,
        continueWhereYouLeftOffPaused: true,
        progressInTaskbar: false,
        enableSpeakerFill: false,
        ratioVolume: false,
        adBlockerEnabled: false,
        preventIdlePause: false,
      },
      integrations: {
        companionServerEnabled: false,
        companionServerCORSWildcardEnabled: false,
        companionServerLANEnabled: false,
        companionServerAuthTokens: "encrypted",
        discordPresenceEnabled: false,
        discordPresenceHideOnPause: false,
        lastFMEnabled: false,
      },
      lastfm: { scrobblePercent: 50, sessionKey: null },
      shortcuts: { playPause: "", next: "", previous: "", thumbsUp: "", thumbsDown: "", volumeUp: "", volumeDown: "" },
      updates: { autoUpdateEnabled: false, channel: 0 },
      addons: { settings: {} },
    })
  );
  for (const [section, values] of Object.entries(overrides)) {
    state.set(section, { ...state.get(section), ...values });
  }
  return Object.fromEntries(state);
}

export function addonDescriptor(overrides: Partial<AddonDescriptor> = {}, fields: AddonSettingsField[] = []): AddonDescriptor {
  return {
    manifest: { id: "sample", name: "Sample addon", version: "1.0.0", author: "Someone", description: "Does a thing" },
    origin: "bundled",
    enabled: true,
    state: "active",
    restartRequired: false,
    settingsSections: fields.length > 0 ? [{ fields }] : [],
    ...overrides,
  };
}

export const LONG_WORD = "x".repeat(400);
export const WINDOWS_PATH_ERROR = `Cannot find module 'C:\\Users\\Someone\\AppData\\Roaming\\YTMDesktopPlus\\addons\\${"very-long-addon-folder-name-".repeat(12)}\\dist\\index.js'`;
