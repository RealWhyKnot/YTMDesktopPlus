import type { BundledAddonDefinition } from "../../../main/addons/manager";
import { RepeatMode } from "../../../shared/addons/sdk";

import blendScript from "./scripts/blend.script?raw";
import blendDisableScript from "./scripts/blend-disable.script?raw";

const blendAddon: BundledAddonDefinition = {
  manifest: {
    id: "blend",
    name: "Blend",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Overlaps the end of one song with the start of the next, whether it ran out or you skipped it.",
    defaultEnabled: false
  },

  activate(ctx) {
    ctx.settings.registerDefaults({ seconds: 5 });
    ctx.settings.registerSettingsUI([
      {
        fields: [
          {
            key: "seconds",
            type: "number",
            label: "Blend length",
            description: "How long the two songs overlap.",
            min: 1,
            max: 12,
            step: 0.5,
            display: "slider"
          }
        ]
      }
    ]);

    ctx.ytmview.registerScript("blend", blendScript);
    ctx.ytmview.registerScript("blend-disable", blendDisableScript);

    const nextAvailable = (queue: ReturnType<typeof ctx.player.getQueue>) =>
      queue ? queue.selectedItemIndex < queue.items.length - 1 || queue.automixItems.length > 0 || queue.isInfinite : false;

    const initialQueue = ctx.player.getQueue();
    let repeatOne = initialQueue?.repeatMode === RepeatMode.One;
    let adPlaying = ctx.player.getState().adPlaying;
    let hasNext = nextAvailable(initialQueue);

    const apply = async () => {
      try {
        const applied = await ctx.ytmview.invokeScript("blend", {
          seconds: ctx.settings.get<number>("seconds") ?? 5,
          repeatOne,
          adPlaying,
          hasNext
        });
        if (applied !== true) ctx.log.info("Blend could not attach yet; the page has no audio graph");
      } catch (error) {
        ctx.log.warn("Blend failed to apply", error);
      }
    };

    const unsubscribes = [
      ctx.settings.onDidChange("seconds", () => void apply()),
      ctx.ytmview.onLoaded(apply),
      ctx.ytmview.onMessage("diag", payload => {
        const data = payload as Record<string, unknown>;
        if (typeof data?.event !== "string") return;
        const detail = Object.entries(data)
          .filter(([key]) => key !== "event")
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(" ");
        ctx.log.info(`blend ${data.event}${detail ? ` ${detail}` : ""}`);
      }),
      ctx.player.on("adStateChanged", payload => {
        adPlaying = payload.adPlaying;
        void apply();
      }),
      ctx.player.on("repeatModeChanged", payload => {
        repeatOne = payload.repeatMode === RepeatMode.One;
        void apply();
      }),
      ctx.player.on("queueChanged", payload => {
        const next = nextAvailable(payload.queue);
        if (next === hasNext) return;
        hasNext = next;
        void apply();
      })
    ];

    return {
      destroy() {
        for (const unsubscribe of unsubscribes) unsubscribe();
        try {
          ctx.ytmview.runScript("blend-disable");
        } catch {
          // View already gone.
        }
      }
    };
  }
};

export default blendAddon;
