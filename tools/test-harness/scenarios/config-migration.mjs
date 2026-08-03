// Boots against a config written by an older release and verifies the store
// migrations run, existing settings survive, and the app still comes up.

import { readFileSync } from "node:fs";
import path from "node:path";

export const fixture = {
  __internal__: { migrations: { version: "2.0.6" } },
  metadata: { version: 1 },
  general: {
    disableHardwareAcceleration: false,
    hideToTrayOnClose: true,
    showNotificationOnSongChange: false,
    startOnBoot: false,
    startMinimized: false
  },
  // trayIconStyle deliberately missing: the >=2.0.7 migration must add it.
  appearance: {
    alwaysShowVolumeSlider: false,
    customCSSEnabled: false,
    customCSSPath: null,
    zoom: 150
  },
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: true,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false
  },
  integrations: {
    companionServerEnabled: false,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false
  },
  shortcuts: { playPause: "", next: "", previous: "", thumbsUp: "", thumbsDown: "", volumeUp: "", volumeDown: "" },
  state: { lastUrl: "https://music.youtube.com/", lastPlaylistId: "", lastVideoId: "", windowBounds: null, windowMaximized: false },
  lastfm: { api_key: "unused", secret: "unused", token: null, sessionKey: null, scrobblePercent: 75 },
  developer: { enableDevTools: false }
};

export default async function configMigration(ctx) {
  await ctx.step("migrations run", () => ctx.waitMainLog(/Performing store migration/, 30000), 35000);

  await ctx.step("app loads with migrated config", () => ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoading')", loading => loading === false, 90000), 95000);

  await ctx.step("settings survive and gaps are filled", async () => {
    const config = JSON.parse(readFileSync(path.join(ctx.profileDir, "config.json"), "utf8"));
    const checks = [
      ["general.hideToTrayOnClose", config.general?.hideToTrayOnClose, true],
      ["appearance.zoom", config.appearance?.zoom, 150],
      ["appearance.trayIconStyle added by migration", config.appearance?.trayIconStyle, 0],
      ["lastfm.scrobblePercent", config.lastfm?.scrobblePercent, 75]
    ];
    for (const [name, actual, expected] of checks) {
      if (actual !== expected) throw new Error(`${name}: expected ${expected}, got ${actual}`);
    }
    if (config.__internal__?.migrations?.version === "2.0.6") {
      throw new Error("migration version was not advanced");
    }
  });
}
