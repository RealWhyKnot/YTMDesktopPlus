import type { BundledAddonDefinition } from "../../../main/addons/managed-addon";

import boostScript from "./scripts/boost.script?raw";

import boostCss from "./boost.user.css?raw";

const CEILINGS = [150, 200, 300, 500];

const volumeBoostAddon = {
  manifest: {
    id: "volume-boost",
    name: "Volume boost",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Takes the volume slider past 100%. The boosted part of the bar changes colour, and a limiter keeps loud tracks from clipping.",
    defaultEnabled: false,
  },

  activate(ctx) {
    ctx.settings.registerDefaults({ ceiling: 200, limiter: true });
    ctx.settings.registerSettingsUI([
      {
        fields: [
          {
            key: "ceiling",
            type: "select",
            label: "Maximum volume",
            options: CEILINGS.map((value) => ({ label: `${value}%`, value })),
          },
          {
            key: "limiter",
            type: "toggle",
            label: "Limiter",
            description: "Holds boosted peaks down instead of letting them clip. Turning this off is louder and rougher.",
          },
        ],
      },
    ]);

    ctx.ytmview.registerScript("boost", boostScript);

    const apply = async () => {
      const ceiling = ctx.settings.get("ceiling") ?? 200;
      const isLimiter = ctx.settings.get("limiter") ?? true;
      try {
        const applied = await ctx.ytmview.invokeScript("boost", { ceiling, limiter: isLimiter });
        if (applied !== true) ctx.log.info("Volume boost could not attach yet; the page has no audio graph");
      } catch (error) {
        ctx.log.warn("Volume boost failed to apply", error);
      }
    };

    const css = ctx.ytmview.insertCSS(boostCss);
    const unsubscribeCeiling = ctx.settings.onDidChange("ceiling", apply);
    const unsubscribeLimiter = ctx.settings.onDidChange("limiter", apply);
    const unsubscribeLoaded = ctx.ytmview.onLoaded(apply);

    return {
      destroy() {
        unsubscribeCeiling();
        unsubscribeLimiter();
        unsubscribeLoaded();
        void css.remove().catch((error: unknown) => console.warn("destroy failed", error));
      },
    };
  },
} satisfies BundledAddonDefinition;

export { volumeBoostAddon };
