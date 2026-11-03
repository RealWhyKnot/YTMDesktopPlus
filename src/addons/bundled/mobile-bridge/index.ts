import type { BundledAddonDefinition } from "../../../main/addons/managed-addon";
import { VideoState } from "~shared/addons/sdk";
import { MirrorEngine, type Mirror } from "./mirror-engine";
import { extractDurationSeconds, extractHistoryHead } from "./history-parse";
import bannerScript from "./scripts/banner.script?raw";

import bannerCss from "./banner.css?raw";

const mobileBridgeAddon = {
  manifest: {
    id: "mobile-bridge",
    name: "Phone playback",
    version: "1.0.0",
    author: "WhyKnot",
    description: "While nothing plays here, shows what your phone is playing by the player bar and on your Discord presence.",
    defaultEnabled: false,
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
            description: "While nothing plays here, your presence shows the track your phone is playing. The badge and player bar strip always show",
          },
        ],
      },
    ]);

    ctx.ytmview.registerScript("banner", bannerScript);
    ctx.ytmview.insertCSS(bannerCss);

    let mirror: Mirror | null = null;

    const pushSurfaces = () => {
      ctx.ytmview.invokeScript("banner", mirror ? { action: "show", track: mirror.track } : { action: "hide" }).catch((error: unknown) => {
        ctx.log.debug("Banner update skipped", String(error));
      });
      ctx.titlebar.setBadge(
        mirror
          ? {
              icon: "smartphone",
              tooltip: `Playing on your phone: ${mirror.track.title}`,
              active: true,
            }
          : null
      );
      ctx.discord.refreshActivity();
    };

    ctx.discord.registerRemoteActivityProvider(() => {
      if (!mirror || !ctx.settings.get("discordMirrorEnabled")) return undefined;
      return {
        title: mirror.track.title,
        author: mirror.track.author,
        thumbnailUrl: mirror.track.thumbnailUrl ?? undefined,
        videoId: mirror.track.videoId,
        startedAtEpochMs: mirror.firstSeenMs,
        smallText: "Playing on your phone",
      };
    });

    const engine = new MirrorEngine({
      fetchHead: async () => extractHistoryHead(await ctx.innertube.request("browse", { browseId: "FEmusic_history" })),
      fetchDuration: async (videoId) => extractDurationSeconds(await ctx.innertube.request("player", { videoId })),
      onChange: (next) => {
        mirror = next;
        if (next) ctx.log.info(`Mirroring phone playback: ${next.track.title}`);
        else ctx.log.info("Phone playback mirror cleared");
        pushSurfaces();
      },
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (handle) => clearTimeout(handle),
      onPollError: (error) => ctx.log.debug("History poll failed", String(error)),
    });

    const noteLocalState = (state: ReturnType<typeof ctx.player.getState>) => {
      engine.noteLocalState({
        playing: state.trackState === VideoState.Playing,
        videoId: state.videoDetails?.id ?? null,
        hasFullMetadata: state.hasFullMetadata,
      });
    };
    ctx.player.onStateChanged(noteLocalState);
    noteLocalState(ctx.player.getState());

    let isEngineStarted = false;
    ctx.ytmview.onLoaded(() => {
      if (!isEngineStarted) {
        isEngineStarted = true;
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
      },
    };
  },
} satisfies BundledAddonDefinition;

export { mobileBridgeAddon };
