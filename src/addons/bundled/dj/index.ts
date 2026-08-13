import path from "path";
import type { BundledAddonDefinition } from "../../../main/addons/manager";
import { RepeatMode, type VideoDetails } from "../../../shared/addons/sdk";

import crossfadeScript from "./scripts/crossfade.script?raw";
import crossfadeDisableScript from "./scripts/crossfade-disable.script?raw";
import catalogScript from "./scripts/catalog.script?raw";
import enqueueScript from "./scripts/enqueue.script?raw";

import { Analyzer } from "./analyzer";
import { FeatureDb } from "./feature-db";
import { findQueueItemRenderer, pickNext, type NextPick } from "./auto-dj";
import { planTransition } from "./transition-plan";

const SETTING_KEYS = ["fadeOut", "fadeIn", "curve", "fadeOnManualSkip", "fadeOnRepeatOne", "autoDj"] as const;
const CATALOG_DELAY_MS = 12000;
const RECENT_LIMIT = 20;

const djAddon: BundledAddonDefinition = {
  manifest: {
    id: "dj",
    name: "DJ",
    version: "1.0.0",
    author: "WhyKnot",
    description:
      "Blends song changes into each other instead of cutting off, learns the tempo, key and energy of what plays, and can pick the next track like a DJ.",
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
            label: "Auto DJ",
            description: "Pick the upcoming track by tempo, key and energy instead of queue order, with beat-matched blends."
          }
        ]
      }
    ]);

    ctx.ytmview.registerScript("crossfade", crossfadeScript);
    ctx.ytmview.registerScript("crossfade-disable", crossfadeDisableScript);
    ctx.ytmview.registerScript("catalog", catalogScript);
    ctx.ytmview.registerScript("enqueue", enqueueScript);

    const db = new FeatureDb(path.join(ctx.paths.data, "features.json"));
    await db.load();

    const analyzer = new Analyzer(ctx, features => {
      db.set(features);
      recomputePick();
      void apply();
    });

    const nextAvailable = (queue: ReturnType<typeof ctx.player.getQueue>) =>
      queue ? queue.selectedItemIndex < queue.items.length - 1 || queue.automixItems.length > 0 || queue.isInfinite : false;

    const initialQueue = ctx.player.getQueue();
    let repeatOne = initialQueue?.repeatMode === RepeatMode.One;
    let adPlaying = ctx.player.getState().adPlaying;
    let hasNext = initialQueue ? nextAvailable(initialQueue) : true;
    let currentTrack: VideoDetails | null = ctx.player.getState().videoDetails;
    let pick: NextPick | null = null;
    const recentVideoIds: string[] = [];
    let catalogTimer: NodeJS.Timeout | null = null;

    const autoDjOn = () => ctx.settings.get<boolean>("autoDj") === true;

    let enqueueInFlight: string | null = null;
    const failedEnqueues = new Set<string>();

    // A library pick lives outside the queue; it becomes reachable for the
    // transition only once it sits in the queue as the next item.
    const ensureEnqueued = async (wanted: NextPick) => {
      if (enqueueInFlight || failedEnqueues.has(wanted.videoId)) return;
      enqueueInFlight = wanted.videoId;
      try {
        const response = await ctx.innertube.request("next", { videoId: wanted.videoId });
        const item = findQueueItemRenderer(response, wanted.videoId);
        if (!item) throw new Error("no queue renderer in the next response");
        const index = await ctx.ytmview.invokeScript("enqueue", { item });
        if (typeof index !== "number" || index < 0) throw new Error(`enqueue landed at ${index}`);
      } catch (error) {
        failedEnqueues.add(wanted.videoId);
        ctx.log.info(`Could not enqueue library pick ${wanted.videoId}`, error);
      } finally {
        enqueueInFlight = null;
      }
    };

    const recomputePick = () => {
      pick = autoDjOn() ? pickNext(ctx.player.getQueue(), currentTrack, db, recentVideoIds) : null;
      if (pick && pick.source === "library" && pick.queueIndex == null) void ensureEnqueued(pick);
      ctx.titlebar.setBadge(
        autoDjOn() ? { icon: "album", active: true, tooltip: pick ? `Auto DJ next: ${pick.title}` : "Auto DJ: waiting for candidates" } : null
      );
    };

    const apply = async () => {
      const fadeOutSetting = ctx.settings.get<number>("fadeOut") ?? 5;
      const fadeInSetting = ctx.settings.get<number>("fadeIn") ?? 1.5;
      const plan = planTransition(currentTrack ? db.get(currentTrack.id) : null, pick ? db.get(pick.videoId) : null, {
        fadeOutS: fadeOutSetting,
        fadeInS: fadeInSetting
      });
      try {
        const applied = await ctx.ytmview.invokeScript("crossfade", {
          enabled: true,
          fadeOutS: pick ? plan.fadeOutS : fadeOutSetting,
          fadeInS: plan.fadeInS,
          curve: ctx.settings.get<number>("curve") ?? 0,
          fadeOnManualSkip: ctx.settings.get<boolean>("fadeOnManualSkip") ?? true,
          fadeOnRepeatOne: ctx.settings.get<boolean>("fadeOnRepeatOne") ?? false,
          repeatOne,
          adPlaying,
          hasNext,
          transitionIndex: pick && pick.queueIndex != null ? pick.queueIndex : null,
          beatOffsetS: pick ? plan.beatOffsetS : null,
          beatPeriodS: pick ? plan.beatPeriodS : null,
          incomingRate: pick ? plan.incomingRate : null,
          rateGlideS: plan.rateGlideS
        });
        if (applied !== true) ctx.log.info("Crossfade could not attach yet; the page has no audio graph");
      } catch (error) {
        ctx.log.warn("Crossfade failed to apply", error);
      }
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
        recomputePick();
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
      ctx.ytmview.onMessage("transitionNow", payload => {
        const data = payload as { index?: unknown };
        if (typeof data?.index !== "number" || !Number.isInteger(data.index) || data.index < 0) return;
        ctx.playback.playQueueIndex(data.index);
      })
    );
    unsubscribes.push(
      ctx.player.on("trackChanged", payload => {
        currentTrack = payload.current;
        if (payload.current) {
          recentVideoIds.unshift(payload.current.id);
          if (recentVideoIds.length > RECENT_LIMIT) recentVideoIds.pop();
          scheduleCatalog(payload.current.id);
        }
        recomputePick();
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
        const before = pick?.videoId;
        recomputePick();
        if (changed || pick?.videoId !== before) void apply();
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
