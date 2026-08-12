// A complete starting point. Copy this folder into the addons directory (in
// the app: Settings -> Addons -> Open addons folder), rename the folder and
// the id in manifest.json, restart, then enable the addon and restart again.
//
// ytmd-addon.d.ts next to this file types everything on ctx; tsconfig.json
// makes editors check this file against it as you type.

/** @type {import("./ytmd-addon").AddonActivate} */
module.exports.activate = ctx => {
  ctx.log.info("Template addon active");

  // Defaults fill only what the user has not set; the fields below render on
  // the addon's card in Settings. Values apply when the user saves.
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
            { label: "Formal", value: "formal" }
          ]
        }
      ]
    }
  ]);

  const applyBadge = () => {
    ctx.titlebar.setBadge(ctx.settings.get("showBadge") ? { icon: "waving_hand", tooltip: String(ctx.settings.get("greeting")) } : null);
  };
  applyBadge();
  ctx.settings.onDidChange("showBadge", applyBadge);
  ctx.settings.onDidChange("greeting", applyBadge);

  // Typed player events: this fires only when the track actually changes.
  ctx.player.on("trackChanged", ({ current }) => {
    if (current) ctx.log.info(`Now playing: ${current.title} by ${current.author}`);
  });

  // Scripts listed in manifest.json run on their own after every page load;
  // invoking one by name also returns whatever it evaluates to.
  ctx.ytmview.onLoaded(async () => {
    const snapshot = await ctx.ytmview.invokeScript("page.script");
    ctx.log.info("Page snapshot", snapshot);
  });

  return {
    destroy() {
      ctx.titlebar.setBadge(null);
    }
  };
};
