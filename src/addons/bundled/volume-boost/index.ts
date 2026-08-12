import type { BundledAddonDefinition } from "../../../main/addons/manager";

import boostScript from "./scripts/boost.script?raw";

// The boosted part of the volume bar is drawn by recolouring the fill YouTube
// Music already renders. The fill is one element scaled horizontally, so the
// gradient stop is expressed in its own box and the script sets it per change.
const BOOST_CSS = `
  ytmusic-player-bar #volume-slider.ytmd-boosted #sliderBar #primaryProgress {
    background: linear-gradient(
      to right,
      #ffffff 0 var(--ytmd-boost-split, 100%),
      #ff5252 var(--ytmd-boost-split, 100%) 100%
    ) !important;
  }

  ytmusic-player-bar #volume-slider.ytmd-boosted .slider-knob-inner {
    background-color: #ff5252 !important;
  }
`;

const CEILINGS = [150, 200, 300, 500];

const volumeBoostAddon: BundledAddonDefinition = {
  manifest: {
    id: "volume-boost",
    name: "Volume boost",
    version: "1.0.0",
    author: "WhyKnot",
    description: "Lets the volume slider go past 100%, colouring the boosted part of the bar. A limiter keeps loud tracks from clipping.",
    defaultEnabled: false
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
            options: CEILINGS.map(value => ({ label: `${value}%`, value }))
          },
          {
            key: "limiter",
            type: "toggle",
            label: "Limiter",
            description: "Holds boosted peaks down instead of letting them clip. Turning this off is louder and rougher."
          }
        ]
      }
    ]);

    ctx.ytmview.registerScript("boost", boostScript);

    const apply = async () => {
      const ceiling = ctx.settings.get<number>("ceiling") ?? 200;
      const limiter = ctx.settings.get<boolean>("limiter") ?? true;
      try {
        const applied = await ctx.ytmview.invokeScript("boost", { ceiling, limiter });
        if (applied !== true) ctx.log.info("Volume boost could not attach yet; the page has no audio graph");
      } catch (error) {
        ctx.log.warn("Volume boost failed to apply", error);
      }
    };

    const css = ctx.ytmview.insertCSS(BOOST_CSS);
    const unsubscribeCeiling = ctx.settings.onDidChange("ceiling", apply);
    const unsubscribeLimiter = ctx.settings.onDidChange("limiter", apply);
    const unsubscribeLoaded = ctx.ytmview.onLoaded(apply);

    return {
      destroy() {
        unsubscribeCeiling();
        unsubscribeLimiter();
        unsubscribeLoaded();
        css.remove();
      }
    };
  }
};

export default volumeBoostAddon;
