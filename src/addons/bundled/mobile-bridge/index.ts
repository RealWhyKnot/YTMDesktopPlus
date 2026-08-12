import type { BundledAddonDefinition } from "../../../main/addons/manager";
import { VideoState } from "~shared/addons/sdk";
import { MirrorEngine, type Mirror } from "./mirror-engine";
import { extractDurationSeconds, extractHistoryHead } from "./history-parse";
import bannerScript from "./scripts/banner.script?raw";

const BANNER_CSS = `
#ytmd-phone-banner {
  position: fixed;
  right: 16px;
  bottom: 88px;
  z-index: 999;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px 8px 8px;
  background: rgba(20, 20, 20, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  font-family: Roboto, Arial, sans-serif;
  color: #ffffff;
}
#ytmd-phone-banner .ytmd-phone-banner-art {
  width: 40px;
  height: 40px;
  border-radius: 4px;
}
#ytmd-phone-banner .ytmd-phone-banner-title {
  font-size: 13px;
  font-weight: 500;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#ytmd-phone-banner .ytmd-phone-banner-subtitle {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#ytmd-phone-banner .ytmd-phone-banner-caption {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
}
`;

// Surfaces what is playing on another device on the same account (usually a
// phone) while nothing plays here: a strip by the player bar, a title bar
// badge, and optionally the Discord presence. Detection polls the account's
// listening history through the YTM page; playback is never touched, so the
// phone is never interrupted. Anything playing locally always wins.
const mobileBridgeAddon: BundledAddonDefinition = {
  manifest: {
    id: "mobile-bridge",
    name: "Phone playback",
    version: "1.0.0",
    author: "WhyKnot",
    description: "While nothing plays here, shows what your phone is playing by the player bar and on your Discord presence.",
    defaultEnabled: false
  },

  activate(ctx) {
    ctx.settings.registerDefaults({ discordMirrorEnabled: true });
    ctx.settings.registerSettingsUI([
      {
        fields: [
          {
            key: "discordMirrorEnabled",
            type: "toggle",
            label: "Show on Discord presence",
            description: "While nothing plays here, your presence shows the track your phone is playing. The badge and player bar strip always show"
          }
        ]
      }
    ]);

    ctx.ytmview.registerScript("banner", bannerScript);
    ctx.ytmview.insertCSS(BANNER_CSS);

    let mirror: Mirror | null = null;

    const pushSurfaces = () => {
      ctx.ytmview.invokeScript("banner", mirror ? { action: "show", track: mirror.track } : { action: "hide" }).catch(error => {
        ctx.log.debug("Banner update skipped", String(error));
      });
      ctx.titlebar.setBadge(
        mirror
          ? {
              icon: "smartphone",
              tooltip: `Playing on your phone: ${mirror.track.title}`,
              active: true
            }
          : null
      );
      ctx.discord.refreshActivity();
    };

    ctx.discord.registerRemoteActivityProvider(() => {
      if (!mirror || !ctx.settings.get<boolean>("discordMirrorEnabled")) return undefined;
      return {
        title: mirror.track.title,
        author: mirror.track.author,
        thumbnailUrl: mirror.track.thumbnailUrl ?? undefined,
        videoId: mirror.track.videoId,
        startedAtEpochMs: mirror.firstSeenMs,
        smallText: "Playing on your phone"
      };
    });

    const engine = new MirrorEngine({
      // A track playing on any device on the account reaches the history head
      // within seconds of starting (measured 2026-08-11). Read-only: it never
      // joins, claims or controls a session.
      fetchHead: async () => extractHistoryHead(await ctx.innertube.request("browse", { browseId: "FEmusic_history" })),
      fetchDuration: async videoId => extractDurationSeconds(await ctx.innertube.request("player", { videoId })),
      onChange: next => {
        mirror = next;
        if (next) ctx.log.info(`Mirroring phone playback: ${next.track.title}`);
        else ctx.log.info("Phone playback mirror cleared");
        pushSurfaces();
      },
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: handle => clearTimeout(handle as NodeJS.Timeout),
      onPollError: error => ctx.log.debug("History poll failed", String(error))
    });

    const noteLocalState = (state: ReturnType<typeof ctx.player.getState>) => {
      engine.noteLocalState({
        playing: state.trackState === VideoState.Playing,
        videoId: state.videoDetails?.id ?? null,
        hasFullMetadata: state.hasFullMetadata
      });
    };
    ctx.player.onStateChanged(noteLocalState);
    noteLocalState(ctx.player.getState());

    // Polling can only work once the page is up, so the engine starts on the
    // first loaded signal; later reloads wipe injected DOM, so re-push instead.
    let engineStarted = false;
    ctx.ytmview.onLoaded(() => {
      if (!engineStarted) {
        engineStarted = true;
        engine.start();
      } else {
        pushSurfaces();
      }
    });

    ctx.settings.onDidChange("discordMirrorEnabled", () => ctx.discord.refreshActivity());

    return {
      destroy() {
        engine.stop();
        mirror = null;
        pushSurfaces();
      }
    };
  }
};

export default mobileBridgeAddon;
