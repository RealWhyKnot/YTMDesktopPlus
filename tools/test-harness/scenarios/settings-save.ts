import { array, optionalRecord, record } from "../values.ts";
import { parseJson } from "../validation.ts";
import type { HarnessContext } from "../run.ts";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

export const fixture = {
  general: { hideToTrayOnClose: false },
};

const SETTINGS_WINDOW = /windows\/settings\//;

async function settingsSave(ctx: HarnessContext) {
  const readConfig = () => parseJson(readFileSync(path.join(ctx.profileDir, "config.json"), "utf8"));
  const saveAndReadBack = (entries: [string, unknown][]) =>
    ctx.evalOnTarget(
      SETTINGS_WINDOW,
      `window.ytmd.store.setMany(${JSON.stringify(entries)}); Promise.all([window.ytmd.store.get("appearance"), window.ytmd.store.get("lastfm")])`
    );

  await ctx.step(
    "settings window opens",
    async () => {
      await ctx.evalMain("window.ytmd.openSettingsWindow()");
      await ctx.waitTarget(SETTINGS_WINDOW, 15000);
      await ctx.waitOnTarget(SETTINGS_WINDOW, "typeof window.ytmd?.store?.setMany", (kind) => kind === "function", 15000);
    },
    35000
  );

  await ctx.step("a saved batch reads back and reaches config.json", async () => {
    const [appearance, lastfm] = array(
      await saveAndReadBack([
        ["appearance.zoom", 110],
        ["lastfm.scrobblePercent", 60],
      ])
    );
    if (record(appearance).zoom !== 110 || record(lastfm).scrobblePercent !== 60)
      throw new Error(`read back ${String(record(appearance).zoom)}, ${String(record(lastfm).scrobblePercent)}`);
    const deadline = Date.now() + 5000;
    for (;;) {
      const config = readConfig();
      if (optionalRecord(record(config).appearance)?.zoom === 110 && optionalRecord(record(config).lastfm)?.scrobblePercent === 60) return;
      if (Date.now() > deadline)
        throw new Error(
          `config.json has ${String(optionalRecord(record(config).appearance)?.zoom)}, ${String(optionalRecord(record(config).lastfm)?.scrobblePercent)}`
        );
      await new Promise((r) => setTimeout(r, 100));
    }
  });

  await ctx.step(
    "a change saved just before quit and the window state written during quit are on disk",
    async () => {
      const [appearance] = array(await saveAndReadBack([["appearance.zoom", 120]]));
      if (record(appearance).zoom !== 120) throw new Error(`read back ${String(record(appearance).zoom)}`);
      ctx.evalMain("window.ytmd.closeWindow()").catch((error: unknown) => {
        console.warn("settings-save: operation failed", error);
      });
      await ctx.waitAppExit(15000);
      const config = readConfig();
      if (optionalRecord(record(config).appearance)?.zoom !== 120)
        throw new Error(`appearance.zoom is ${String(optionalRecord(record(config).appearance)?.zoom)} after quit`);
      if (!optionalRecord(record(config).state)?.windowBounds) throw new Error("state.windowBounds was not written during quit");
      if (ctx.grepMainLog(/Failed to write config file/)) throw new Error("a config write failed");
      const leftovers = readdirSync(ctx.profileDir).filter((name) => name.startsWith("config.json.tmp-"));
      if (leftovers.length > 0) throw new Error(`temp files left behind: ${leftovers.join(", ")}`);
    },
    25000
  );
}

export { settingsSave as runScenario };
