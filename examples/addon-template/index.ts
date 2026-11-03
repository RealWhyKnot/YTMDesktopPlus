import type { AddonContext } from "./ytmd-addon.d.ts";

export function activate(ctx: AddonContext) {
  ctx.log.info("Template addon active");

  ctx.settings.registerDefaults({ greeting: "Hello", showBadge: true, mode: "friendly" });
  ctx.settings.registerSettingsUI([
    {
      fields: [
        { key: "showBadge", type: "toggle", label: "Show a title bar badge" },
        { key: "greeting", type: "text", label: "Badge tooltip", maxlength: 24 },
        {
          key: "mode",
          type: "select",
          label: "Mode",
          options: [
            { label: "Friendly", value: "friendly" },
            { label: "Formal", value: "formal" },
          ],
        },
        { key: "openPanel", type: "button", label: "Example window", buttonText: "Open panel" },
      ],
    },
  ]);

  ctx.settings.onAction("openPanel", () => {
    ctx.windows.create({ file: "panel.html", width: 380, height: 260, title: "Template panel" });
  });

  const applyBadge = () => {
    ctx.titlebar.setBadge(ctx.settings.get("showBadge") ? { icon: "waving_hand", tooltip: String(ctx.settings.get("greeting")) } : null);
  };
  applyBadge();
  ctx.settings.onDidChange("showBadge", applyBadge);
  ctx.settings.onDidChange("greeting", applyBadge);

  ctx.player.on("trackChanged", ({ current }) => {
    if (current) ctx.log.info(`Now playing: ${current.title} by ${current.author}`);
  });

  ctx.ytmview.onLoaded(async () => {
    const snapshot = await ctx.ytmview.invokeScript("page.script");
    ctx.log.info("Page snapshot", snapshot);
  });

  return {
    destroy() {
      ctx.titlebar.setBadge(null);
    },
  };
}
