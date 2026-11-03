import type { HarnessContext } from "../run.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const fixture = {
  general: { hideToTrayOnClose: false },
  addons: {
    states: { "hidden-window": { enabled: true, riskAcknowledged: true } },
    settings: {},
  },
};

export function prepareProfile(profileDir: string) {
  const dir = path.join(profileDir, "addons", "hidden-window");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify({
      id: "hidden-window",
      name: "Hidden window",
      version: "1.0.0",
      author: "harness",
      description: "Holds a hidden window open across a main window close",
      apiVersion: 1,
      main: "index.js",
    })
  );
  writeFileSync(path.join(dir, "blank.html"), "<!doctype html><title>blank</title>\n");
  writeFileSync(
    path.join(dir, "index.js"),
    'module.exports.activate = ctx => {\n  ctx.windows.create({ file: "blank.html", width: 200, height: 100, show: false });\n};\n'
  );
}

async function closeMainWindow(ctx: HarnessContext) {
  await ctx.step(
    "addon activates with its hidden window",
    async () => {
      await ctx.waitMainLog(/Addon active: hidden-window/, 60000);
      await ctx.waitTarget(/blank\.html/, 20000);
    },
    65000
  );

  await ctx.step(
    "native close quits the app",
    async () => {
      ctx.evalMain("window.close()").catch((error: unknown) => {
        console.warn("close-main-window: operation failed", error);
      });
      await ctx.waitAppExit(15000);
    },
    20000
  );
}

export { closeMainWindow as runScenario };
