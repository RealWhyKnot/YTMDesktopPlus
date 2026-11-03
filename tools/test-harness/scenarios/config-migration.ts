import { optionalRecord, record } from "../values.ts";
import { parseJson } from "../validation.ts";
import type { HarnessContext } from "../run.ts";
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
    startMinimized: false,
  },

  appearance: {
    alwaysShowVolumeSlider: false,
    customCSSEnabled: false,
    customCSSPath: null,
    zoom: 150,
  },
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: true,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false,
  },
  integrations: {
    companionServerEnabled: false,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false,
  },
  shortcuts: { playPause: "", next: "", previous: "", thumbsUp: "", thumbsDown: "", volumeUp: "", volumeDown: "" },
  state: { lastUrl: "https://music.youtube.com/", lastPlaylistId: "", lastVideoId: "", windowBounds: null, windowMaximized: false },
  lastfm: { api_key: "unused", secret: "unused", token: null, sessionKey: null, scrobblePercent: 75 },
  developer: { enableDevTools: false },
};

async function configMigration(ctx: HarnessContext) {
  await ctx.step("migrations run", () => ctx.waitMainLog(/Performing store migration/, 30000), 35000);

  await ctx.step(
    "app loads with migrated config",
    () => ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoading')", (loading) => loading === false, 90000),
    95000
  );

  await ctx.step("settings survive and gaps are filled", () => {
    const config = parseJson(readFileSync(path.join(ctx.profileDir, "config.json"), "utf8"));
    const checks = [
      ["general.hideToTrayOnClose", optionalRecord(record(config).general)?.hideToTrayOnClose, true],
      ["appearance.zoom", optionalRecord(record(config).appearance)?.zoom, 150],
      ["appearance.trayIconStyle added by migration", optionalRecord(record(config).appearance)?.trayIconStyle, 0],
      ["lastfm.scrobblePercent", optionalRecord(record(config).lastfm)?.scrobblePercent, 75],
    ];
    for (const [name, actual, expected] of checks) {
      if (actual !== expected) throw new Error(`${String(name)}: expected ${String(expected)}, got ${String(actual)}`);
    }
    if (optionalRecord(optionalRecord(record(config).__internal__)?.migrations)?.version === "2.0.6") {
      throw new Error("migration version was not advanced");
    }
    if (typeof optionalRecord(record(config).developer)?.debugLogging !== "boolean") {
      throw new Error("developer.debugLogging was not backfilled");
    }

    for (const key of ["adBlockerEnabled", "preventIdlePause"]) {
      if (optionalRecord(record(config).playback)?.[key] !== false) {
        throw new Error(`playback.${key} was not backfilled, got ${String(optionalRecord(record(config).playback)?.[key])}`);
      }
    }
  });
}

export { configMigration as runScenario };
