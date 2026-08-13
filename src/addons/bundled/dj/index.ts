import type { BundledAddonDefinition } from "../../../main/addons/manager";
import { RepeatMode } from "../../../shared/addons/sdk";

import crossfadeScript from "./scripts/crossfade.script?raw";
import crossfadeDisableScript from "./scripts/crossfade-disable.script?raw";

const SETTING_KEYS = ["fadeOut", "fadeIn", "curve", "fadeOnManualSkip", "fadeOnRepeatOne"] as const;

const djAddon: BundledAddonDefinition = {
  manifest: {
    id: "dj",
    name: "DJ",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Blends song changes into each other. The outgoing track keeps playing under the incoming one instead of cutting off.",
    defaultEnabled: false
  },

  activate(ctx) {
    ctx.settings.registerDefaults({
      fadeOut: 5,
      fadeIn: 1.5,
      curve: 0,
      fadeOnManualSkip: true,
      fadeOnRepeatOne: false
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
          }
        ]
      }
    ]);

    ctx.ytmview.registerScript("crossfade", crossfadeScript);
    ctx.ytmview.registerScript("crossfade-disable", crossfadeDisableScript);

    const nextAvailable = (queue: ReturnType<typeof ctx.player.getQueue>) =>
      queue ? queue.selectedItemIndex < queue.items.length - 1 || queue.automixItems.length > 0 || queue.isInfinite : false;

    const initialState = ctx.player.getState();
    const initialQueue = ctx.player.getQueue();
    let repeatOne = initialQueue?.repeatMode === RepeatMode.One;
    let adPlaying = initialState.adPlaying;
    let hasNext = initialQueue ? nextAvailable(initialQueue) : true;

    const apply = async () => {
      try {
        const applied = await ctx.ytmview.invokeScript("crossfade", {
          enabled: true,
          fadeOutS: ctx.settings.get<number>("fadeOut") ?? 5,
          fadeInS: ctx.settings.get<number>("fadeIn") ?? 1.5,
          curve: ctx.settings.get<number>("curve") ?? 0,
          fadeOnManualSkip: ctx.settings.get<boolean>("fadeOnManualSkip") ?? true,
          fadeOnRepeatOne: ctx.settings.get<boolean>("fadeOnRepeatOne") ?? false,
          repeatOne,
          adPlaying,
          hasNext
        });
        if (applied !== true) ctx.log.info("Crossfade could not attach yet; the page has no audio graph");
      } catch (error) {
        ctx.log.warn("Crossfade failed to apply", error);
      }
    };

    const unsubscribes = SETTING_KEYS.map(key => ctx.settings.onDidChange(key, apply));
    unsubscribes.push(ctx.ytmview.onLoaded(apply));
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
        if (next !== hasNext) {
          hasNext = next;
          void apply();
        }
      })
    );

    return {
      destroy() {
        for (const unsubscribe of unsubscribes) unsubscribe();
        try {
          ctx.ytmview.runScript("crossfade-disable");
        } catch {
          // View already gone.
        }
      }
    };
  }
};

export default djAddon;
