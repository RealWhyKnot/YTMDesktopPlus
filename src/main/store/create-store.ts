import Conf from "conf";
import log from "electron-log";
import { app } from "electron";
import { StoreSchema, TrayIconStyle, UpdateChannel } from "../../shared/store/schema";

// Nothing is bound by default. Media keys are deliberately left alone so
// Chromium keeps answering them through the page's own media session, which
// only responds while this app holds audio focus.
export const DEFAULT_SHORTCUTS = {
  playPause: "",
  next: "",
  previous: "",
  thumbsUp: "",
  thumbsDown: "",
  volumeUp: "",
  volumeDown: ""
};

export function createAppStore(): Conf<StoreSchema> {
  const store = new Conf<StoreSchema>({
    configName: "config",
    cwd: app.getPath("userData"),
    projectVersion: app.getVersion(),
    watch: true,
    defaults: {
      metadata: {
        version: 1
      },
      general: {
        disableHardwareAcceleration: false,
        hideToTrayOnClose: false,
        showNotificationOnSongChange: false,
        startOnBoot: false,
        startMinimized: false
      },
      appearance: {
        alwaysShowVolumeSlider: false,
        zoom: 100,
        trayIconStyle: TrayIconStyle.Auto
      },
      playback: {
        continueWhereYouLeftOff: true,
        continueWhereYouLeftOffPaused: true,
        enableSpeakerFill: false,
        progressInTaskbar: false,
        ratioVolume: false,
        adBlockerEnabled: false,
        preventIdlePause: false
      },
      integrations: {
        companionServerEnabled: false,
        companionServerAuthTokens: null,
        companionServerCORSWildcardEnabled: false,
        discordPresenceEnabled: false,
        discordPresenceHideOnPause: true,
        lastFMEnabled: false,
        listenAlongEnabled: false,
        listenAlongHost: null,
        listenAlongHostPort: 9863,
        listenAlongToken: null
      },
      shortcuts: {
        ...DEFAULT_SHORTCUTS
      },
      state: {
        lastUrl: "https://music.youtube.com/",
        lastPlaylistId: "",
        lastVideoId: "",
        windowBounds: null,
        windowMaximized: false
      },
      lastfm: {
        // Last FM Keys belong to @Alipoodle
        api_key: "2a69bcf769a7a28a8bf2f6a5100accad",
        secret: "46eea23770a459a49eb4d26cbf46b41c",
        token: null,
        sessionKey: null,
        scrobblePercent: 50
      },
      developer: {
        enableDevTools: false,
        // Nightly builds default to debug logging so issues can be reported with
        // logs attached. Stable builds stay quiet unless the user opts in.
        debugLogging: app.getVersion().includes("-beta")
      },
      updates: {
        autoUpdateEnabled: false,
        channel: UpdateChannel.Auto,
        firstRunPromptShown: false
      },
      addons: {
        states: {},
        settings: {}
      }
    },
    beforeEachMigration: (store, context) => {
      log.info(`Performing store migration from ${context.fromVersion} to ${context.toVersion}`);
    },
    migrations: {
      ">=2.0.0": store => {
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        store.delete("integrations.companionServerAuthWindowEnabled");
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        store.delete("state.companionServerAuthWindowEnableTime");
        if (!store.has("appearance.zoom")) {
          store.set("appearance.zoom", 100);
        }
      },
      ">=2.0.1": store => {
        if (!store.has("lastfm.scrobblePercent")) {
          store.set("lastfm.scrobblePercent", 50);
        }
      },
      ">=2.0.7": store => {
        if (!store.has("appearance.trayIconStyle")) {
          store.set("appearance.trayIconStyle", 0);
        }
      }
    }
  });

  // Configs migrated from before a key existed lack it entirely and conf does
  // not deep-merge defaults into stored sections, so backfill each once.
  if (store.get("developer").debugLogging === undefined) {
    store.set("developer.debugLogging", app.getVersion().includes("-beta"));
  }
  if (store.get("updates") === undefined) {
    store.set("updates", { autoUpdateEnabled: false, channel: UpdateChannel.Auto, firstRunPromptShown: false });
  }
  if (store.get("playback").adBlockerEnabled === undefined) {
    store.set("playback.adBlockerEnabled", false);
  }
  // YouTube Music applies its own measured-loudness attenuation to the media
  // element, so the setting that did the same thing on a gain node halved the
  // track twice. Removed rather than fixed; the key goes with it.
  if ((store.get("playback") as Record<string, unknown>).loudnessNormalization !== undefined) {
    store.delete("playback.loudnessNormalization" as keyof StoreSchema);
  }
  if (store.get("playback").preventIdlePause === undefined) {
    store.set("playback.preventIdlePause", false);
  }
  if (store.get("integrations").discordPresenceHideOnPause === undefined) {
    store.set("integrations.discordPresenceHideOnPause", true);
  }
  if (store.get("addons") === undefined) {
    store.set("addons", { states: {}, settings: {} });
  }

  return store;
}
