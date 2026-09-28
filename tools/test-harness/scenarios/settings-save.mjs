import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const fixture = {
  general: { hideToTrayOnClose: false }
};

const SETTINGS_WINDOW = /windows\/settings\//;

export default async function settingsSave(ctx) {
  const readConfig = () => JSON.parse(readFileSync(path.join(ctx.profileDir, "config.json"), "utf8"));
  const saveAndReadBack = entries =>
    ctx.evalOnTarget(
      SETTINGS_WINDOW,
      `window.ytmd.store.setMany(${JSON.stringify(entries)}); Promise.all([window.ytmd.store.get("appearance"), window.ytmd.store.get("lastfm")])`
    );

  await ctx.step(
    "settings window opens",
    async () => {
      await ctx.evalMain("window.ytmd.openSettingsWindow()");
      await ctx.waitTarget(SETTINGS_WINDOW, 15000);
      await ctx.waitOnTarget(SETTINGS_WINDOW, "typeof window.ytmd?.store?.setMany", kind => kind === "function", 15000);
    },
    35000
  );

  await ctx.step("a saved batch reads back and reaches config.json", async () => {
    const [appearance, lastfm] = await saveAndReadBack([
      ["appearance.zoom", 110],
      ["lastfm.scrobblePercent", 60]
    ]);
    if (appearance.zoom !== 110 || lastfm.scrobblePercent !== 60) throw new Error(`read back ${appearance.zoom}, ${lastfm.scrobblePercent}`);
    const deadline = Date.now() + 5000;
    for (;;) {
      const config = readConfig();
      if (config.appearance?.zoom === 110 && config.lastfm?.scrobblePercent === 60) return;
      if (Date.now() > deadline) throw new Error(`config.json has ${config.appearance?.zoom}, ${config.lastfm?.scrobblePercent}`);
      await new Promise(r => setTimeout(r, 100));
    }
  });

  await ctx.step(
    "a change saved just before quit and the window state written during quit are on disk",
    async () => {
      const [appearance] = await saveAndReadBack([["appearance.zoom", 120]]);
      if (appearance.zoom !== 120) throw new Error(`read back ${appearance.zoom}`);
      ctx.evalMain("window.ytmd.closeWindow()").catch(() => {});
      await ctx.waitAppExit(15000);
      const config = readConfig();
      if (config.appearance?.zoom !== 120) throw new Error(`appearance.zoom is ${config.appearance?.zoom} after quit`);
      if (!config.state?.windowBounds) throw new Error("state.windowBounds was not written during quit");
      if (ctx.grepMainLog(/Failed to write config file/)) throw new Error("a config write failed");
      const leftovers = readdirSync(ctx.profileDir).filter(name => name.startsWith("config.json.tmp-"));
      if (leftovers.length > 0) throw new Error(`temp files left behind: ${leftovers.join(", ")}`);
    },
    25000
  );
}
