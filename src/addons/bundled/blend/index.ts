import type { BundledAddonDefinition } from "../../../main/addons/managed-addon";
import { isRecord } from "~shared/unknown";
import { RepeatMode } from "../../../shared/addons/sdk";

import blendScript from "./scripts/blend.script?raw";
import blendDisableScript from "./scripts/blend-disable.script?raw";

const blendAddon = {
  manifest: {
    id: "blend",
    name: "Blend",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Overlaps the end of one song with the start of the next, whether it ran out or you skipped it.",
    defaultEnabled: false,
  },

  activate(ctx) {
    ctx.settings.registerDefaults({ seconds: 5, blendSkips: false });
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
            display: "slider",
          },
          {
            key: "blendSkips",
            type: "toggle",
            label: "Blend skips",
            description: "Overlap songs when you skip, not only when one ends.",
          },
        ],
      },
    ]);

    ctx.ytmview.registerScript("blend", blendScript);
    ctx.ytmview.registerScript("blend-disable", blendDisableScript);

    const nextAvailable = (queue: ReturnType<typeof ctx.player.getQueue>) =>
      queue ? queue.selectedItemIndex < queue.items.length - 1 || queue.automixItems.length > 0 || queue.isInfinite : false;

    const initialQueue = ctx.player.getQueue();
    let isRepeatOne = initialQueue?.repeatMode === RepeatMode.One;
    let isAdPlaying = ctx.player.getState().adPlaying;
    let hasNext = nextAvailable(initialQueue);

    const apply = async () => {
      try {
        const applied = await ctx.ytmview.invokeScript("blend", {
          seconds: ctx.settings.get("seconds") ?? 5,
          blendSkips: ctx.settings.get("blendSkips"),
          repeatOne: isRepeatOne,
          adPlaying: isAdPlaying,
          hasNext,
        });
        if (applied !== true) ctx.log.info("Blend could not attach yet; the page has no audio graph");
      } catch (error) {
        ctx.log.warn("Blend failed to apply", error);
      }
    };

    const unsubscribes = [
      ctx.settings.onDidChange("seconds", () => void apply().catch((error: unknown) => console.warn("activate failed", error))),
      ctx.settings.onDidChange("blendSkips", () => void apply().catch((error: unknown) => console.warn("activate failed", error))),
      ctx.ytmview.onLoaded(apply),
      ctx.ytmview.onMessage("diag", (payload) => {
        if (!isRecord(payload) || typeof payload.event !== "string") return;
        const data = payload;
        const detail = Object.entries(data)
          .filter(([key]) => key !== "event")
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(" ");
        ctx.log.info(`blend ${payload.event}${detail ? ` ${detail}` : ""}`);
      }),
      ctx.player.on("adStateChanged", (payload) => {
        isAdPlaying = payload.adPlaying;
        void apply().catch((error: unknown) => console.warn("activate failed", error));
      }),
      ctx.player.on("repeatModeChanged", (payload) => {
        isRepeatOne = payload.repeatMode === RepeatMode.One;
        void apply().catch((error: unknown) => console.warn("activate failed", error));
      }),
      ctx.player.on("queueChanged", (payload) => {
        const isNext = nextAvailable(payload.queue);
        if (isNext === hasNext) return;
        hasNext = isNext;
        void apply().catch((error: unknown) => console.warn("activate failed", error));
      }),
    ];

    return {
      destroy() {
        for (const unsubscribe of unsubscribes) unsubscribe();
        try {
          ctx.ytmview.runScript("blend-disable");
        } catch (error) {
          console.warn("index: operation failed", error);
        }
      },
    };
  },
} satisfies BundledAddonDefinition;

export { blendAddon };
