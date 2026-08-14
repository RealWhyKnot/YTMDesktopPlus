import path from "path";
import type { BundledAddonDefinition } from "../../../main/addons/manager";
import { RepeatMode, type VideoDetails } from "../../../shared/addons/sdk";

import crossfadeScript from "./scripts/crossfade.script?raw";
import crossfadeDisableScript from "./scripts/crossfade-disable.script?raw";
import catalogScript from "./scripts/catalog.script?raw";

import { Analyzer } from "./analyzer";
import { FeatureDb } from "./feature-db";
import { resolveNextTrack, type NextTrack } from "./auto-dj";
import { planTransition } from "./transition-plan";

const SETTING_KEYS = ["fadeOut", "fadeIn", "curve", "fadeOnManualSkip", "fadeOnRepeatOne", "autoDj"] as const;
const CATALOG_DELAY_MS = 12000;

const djAddon: BundledAddonDefinition = {
  manifest: {
    id: "dj",
    name: "DJ",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Blends song changes into each other instead of cutting off, and learns the tempo of what plays so it can beat-match the blend.",
    defaultEnabled: false
  },

  async activate(ctx) {
    ctx.settings.registerDefaults({
      fadeOut: 5,
      fadeIn: 1.5,
      curve: 0,
      fadeOnManualSkip: true,
      fadeOnRepeatOne: false,
      autoDj: false
    });
    ctx.settings.registerSettingsUI([
      {
        fields: [
          {
            key: "fadeOut",
            type: "number",
            label: "Fade out",
            description: "How many seconds of the ending track blend into the next one.",
            min: 1,
            max: 12,
            step: 0.5,
            display: "slider"
          },
          {
            key: "fadeIn",
            type: "number",
            label: "Fade in",
            description: "How long the incoming track takes to reach full volume.",
            min: 0.5,
            max: 8,
            step: 0.5,
            display: "slider"
          },
          {
            key: "curve",
            type: "select",
            label: "Fade curve",
            options: [
              { label: "Equal power", value: 0 },
              { label: "Linear", value: 1 },
              { label: "Logarithmic", value: 2 }
            ]
          },
          {
            key: "fadeOnManualSkip",
            type: "toggle",
            label: "Fade on manual skip",
            description: "Also ease the next track in when a track is skipped by hand."
          },
          {
            key: "fadeOnRepeatOne",
            type: "toggle",
            label: "Fade on repeat one",
            description: "Blend the track into its own restart while repeating a single track."
          },
          {
            key: "autoDj",
            type: "toggle",
            label: "Beat-matched blends",
            description: "Line the blend up with the beat and nudge the incoming track's tempo to match. Queue order is left alone."
          }
        ]
      }
    ]);

    ctx.ytmview.registerScript("crossfade", crossfadeScript);
    ctx.ytmview.registerScript("crossfade-disable", crossfadeDisableScript);
    ctx.ytmview.registerScript("catalog", catalogScript);

    const db = new FeatureDb(path.join(ctx.paths.data, "features.json"));
    await db.load();

    const analyzer = new Analyzer(ctx, features => {
      db.set(features);
      refreshNext();
      void apply();
    });

    const nextAvailable = (queue: ReturnType<typeof ctx.player.getQueue>) =>
      queue ? queue.selectedItemIndex < queue.items.length - 1 || queue.automixItems.length > 0 || queue.isInfinite : false;

    const initialQueue = ctx.player.getQueue();
    let repeatOne = initialQueue?.repeatMode === RepeatMode.One;
    let adPlaying = ctx.player.getState().adPlaying;
    let hasNext = initialQueue ? nextAvailable(initialQueue) : true;
    let currentTrack: VideoDetails | null = ctx.player.getState().videoDetails;
    let nextTrack: NextTrack | null = null;
    let catalogTimer: NodeJS.Timeout | null = null;

    const autoDjOn = () => ctx.settings.get<boolean>("autoDj") === true;

    // Beat matching needs a tempo on both sides of the change; the badge says
    // which of those two the addon is still missing.
    const refreshNext = () => {
      nextTrack = autoDjOn() ? resolveNextTrack(ctx.player.getQueue()) : null;
      if (!autoDjOn()) {
        ctx.titlebar.setBadge(null);
        return;
      }
      const analyzed = !!(currentTrack && db.get(currentTrack.id)?.bpm) && !!(nextTrack && db.get(nextTrack.videoId)?.bpm);
      ctx.titlebar.setBadge({
        icon: "album",
        active: true,
        tooltip: analyzed && nextTrack ? `Beat-matched blend into ${nextTrack.title}` : "Beat matching: still learning these tracks"
      });
    };

    const apply = async () => {
      const fadeOutSetting = ctx.settings.get<number>("fadeOut") ?? 5;
      const fadeInSetting = ctx.settings.get<number>("fadeIn") ?? 1.5;
      const plan = planTransition(currentTrack ? db.get(currentTrack.id) : null, nextTrack ? db.get(nextTrack.videoId) : null, {
        fadeOutS: fadeOutSetting,
        fadeInS: fadeInSetting
      });
      try {
        const applied = await ctx.ytmview.invokeScript("crossfade", {
          enabled: true,
          fadeOutS: nextTrack ? plan.fadeOutS : fadeOutSetting,
          fadeInS: plan.fadeInS,
          curve: ctx.settings.get<number>("curve") ?? 0,
          fadeOnManualSkip: ctx.settings.get<boolean>("fadeOnManualSkip") ?? true,
          fadeOnRepeatOne: ctx.settings.get<boolean>("fadeOnRepeatOne") ?? false,
          repeatOne,
          adPlaying,
          hasNext,
          beatOffsetS: nextTrack ? plan.beatOffsetS : null,
          beatPeriodS: nextTrack ? plan.beatPeriodS : null,
          incomingRate: nextTrack ? plan.incomingRate : null,
          rateGlideS: plan.rateGlideS
        });
        if (applied !== true) ctx.log.info("Crossfade could not attach yet; the page has no audio graph");
      } catch (error) {
        ctx.log.warn("Crossfade failed to apply", error);
      }
    };

    // A track analyzed while the user was already on the next one is stored
    // without a title, which hides it from the library pool for good since
    // db.has blocks a second analysis. Fill it in when it comes round again.
    const backfillMeta = (track: VideoDetails) => {
      const existing = db.get(track.id);
      if (!existing || existing.title != null) return;
      db.set({ ...existing, title: track.title, author: track.author });
    };

    const scheduleCatalog = (videoId: string) => {
      if (catalogTimer) clearTimeout(catalogTimer);
      catalogTimer = setTimeout(() => {
        catalogTimer = null;
        if (db.has(videoId) || analyzer.isBusy(videoId)) return;
        ctx.ytmview.invokeScript("catalog", { videoId }).catch(() => {
          // View gone or no segment URLs yet; the next track change retries.
        });
      }, CATALOG_DELAY_MS);
    };

    const unsubscribes = SETTING_KEYS.map(key =>
      ctx.settings.onDidChange(key, () => {
        refreshNext();
        void apply();
      })
    );
    unsubscribes.push(ctx.ytmview.onLoaded(apply));
    unsubscribes.push(
      ctx.ytmview.onMessage("audioData", payload => {
        const data = payload as { videoId?: unknown; buffer?: unknown };
        if (typeof data?.videoId !== "string" || !(data.buffer instanceof ArrayBuffer)) return;
        if (db.has(data.videoId)) return;
        const meta = currentTrack?.id === data.videoId ? { title: currentTrack.title, author: currentTrack.author } : undefined;
        analyzer.submit(data.videoId, data.buffer, meta);
      })
    );
    unsubscribes.push(
      ctx.ytmview.onMessage("diag", payload => {
        const data = payload as Record<string, unknown>;
        if (typeof data?.event !== "string") return;
        const detail = Object.entries(data)
          .filter(([key]) => key !== "event")
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(" ");
        ctx.log.info(`transition ${data.event}${detail ? ` ${detail}` : ""}`);
      })
    );
    unsubscribes.push(
      ctx.player.on("trackChanged", payload => {
        currentTrack = payload.current;
        if (payload.current) {
          backfillMeta(payload.current);
          scheduleCatalog(payload.current.id);
        }
        refreshNext();
        void apply();
      })
    );
    unsubscribes.push(
      ctx.player.on("repeatModeChanged", payload => {
        repeatOne = payload.repeatMode === RepeatMode.One;
        void apply();
      })
    );
    unsubscribes.push(
      ctx.player.on("adStateChanged", payload => {
        adPlaying = payload.adPlaying;
        void apply();
      })
    );
    unsubscribes.push(
      ctx.player.on("queueChanged", payload => {
        const next = nextAvailable(payload.queue);
        const changed = next !== hasNext;
        hasNext = next;
        const before = nextTrack?.videoId;
        refreshNext();
        if (changed || nextTrack?.videoId !== before) void apply();
      })
    );

    return {
      async destroy() {
        for (const unsubscribe of unsubscribes) unsubscribe();
        if (catalogTimer) clearTimeout(catalogTimer);
        analyzer.close();
        try {
          ctx.ytmview.runScript("crossfade-disable");
        } catch {
          // View already gone.
        }
        await db.flush();
      }
    };
  }
};

export default djAddon;
