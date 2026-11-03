import { record } from "../values.ts";
import type { HarnessContext } from "../run.ts";
import { appendFileSync } from "node:fs";
import path from "node:path";
import { hooksReadyStep } from "./lib.ts";
import { buildAddonTemplate } from "../../build-addon-template.ts";

export const fixture = {
  addons: {
    states: { "addon-template": { enabled: true, riskAcknowledged: true } },
    settings: {},
  },
};

export async function prepareProfile(profileDir: string) {
  const target = path.join(profileDir, "addons", "addon-template");
  await buildAddonTemplate(target);
}

async function externalAddon(ctx: HarnessContext) {
  await ctx.step("addon activates", () => ctx.waitMainLog(/Addon active: addon-template/, 60000), 65000);

  await ctx.step(
    "runtime descriptor carries state and settings",
    () =>
      ctx.waitMain(
        `window.ytmd.memoryStore.get('addonsRuntime').then(list => {
          const addon = (list ?? []).find(entry => entry.manifest.id === 'addon-template');
          return addon ? { state: addon.state, fields: addon.settingsSections.reduce((n, s) => n + s.fields.length, 0) } : null;
        })`,
        (value) => !!value && record(value).state === "active" && record(value).fields === 3,
        30000
      ),
    35000
  );

  await ctx.step(
    "badge reaches the title bar",
    () =>
      ctx.waitMain(
        `window.ytmd.memoryStore.get('addonTitlebarBadges').then(badges => (badges ?? []).some(badge => badge.addonId === 'addon-template'))`,
        (present) => present === true,
        20000
      ),
    25000
  );

  await hooksReadyStep(ctx);

  await ctx.step(
    "styles live-reload into the page",
    async () => {
      appendFileSync(path.join(ctx.profileDir, "addons", "addon-template", "styles.css"), "\nhtml {\n  --ytmd-template-probe: live;\n}\n");
      await ctx.waitYtm(`getComputedStyle(document.documentElement).getPropertyValue('--ytmd-template-probe').trim()`, (value) => value === "live", 20000);
    },
    25000
  );
}

export { externalAddon as runScenario };
