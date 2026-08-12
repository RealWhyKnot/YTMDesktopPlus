// The external addon pipeline end to end: the shipped template is dropped
// into the profile's addons directory, scanned, required and activated, its
// settings reach the runtime descriptor, its badge reaches the title bar, and
// editing styles.css reaches the page live without a restart.

import { appendFileSync, cpSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hooksReadyStep } from "./lib.mjs";

const templateDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../examples/addon-template");

export const fixture = {
  addons: {
    states: { "addon-template": { enabled: true, riskAcknowledged: true } },
    settings: {}
  }
};

export async function prepareProfile(profileDir) {
  const target = path.join(profileDir, "addons", "addon-template");
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(templateDir, target, { recursive: true });
}

export default async function externalAddon(ctx) {
  await ctx.step("addon activates", () => ctx.waitMainLog(/Addon active: addon-template/, 60000), 65000);

  await ctx.step(
    "runtime descriptor carries state and settings",
    () =>
      ctx.waitMain(
        `window.ytmd.memoryStore.get('addonsRuntime').then(list => {
          const addon = (list ?? []).find(entry => entry.manifest.id === 'addon-template');
          return addon ? { state: addon.state, fields: addon.settingsSections.reduce((n, s) => n + s.fields.length, 0) } : null;
        })`,
        value => value && value.state === "active" && value.fields === 3,
        30000
      ),
    35000
  );

  await ctx.step(
    "badge reaches the title bar",
    () =>
      ctx.waitMain(
        `window.ytmd.memoryStore.get('addonTitlebarBadges').then(badges => (badges ?? []).some(badge => badge.addonId === 'addon-template'))`,
        present => present === true,
        20000
      ),
    25000
  );

  await hooksReadyStep(ctx);

  await ctx.step(
    "styles live-reload into the page",
    async () => {
      appendFileSync(path.join(ctx.profileDir, "addons", "addon-template", "styles.css"), "\nhtml {\n  --ytmd-template-probe: live;\n}\n");
      await ctx.waitYtm(`getComputedStyle(document.documentElement).getPropertyValue('--ytmd-template-probe').trim()`, value => value === "live", 20000);
    },
    25000
  );
}
