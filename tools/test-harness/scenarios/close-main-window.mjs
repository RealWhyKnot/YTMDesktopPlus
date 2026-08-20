// A native close of the main window (Alt+F4, taskbar close) must quit the
// app even while an addon holds a hidden window open. It used to leave a
// headless process behind: window-all-closed never fired because of the
// addon window, and the next store broadcast crashed on the destroyed ytm
// view's webContents. The titlebar close button is a different path (it goes
// through mainWindow:close ipc straight to quitApp), so this closes natively.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

export const fixture = {
  general: { hideToTrayOnClose: false },
  addons: {
    states: { "hidden-window": { enabled: true, riskAcknowledged: true } },
    settings: {}
  }
};

export async function prepareProfile(profileDir) {
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
      main: "index.js"
    })
  );
  writeFileSync(path.join(dir, "blank.html"), "<!doctype html><title>blank</title>\n");
  writeFileSync(
    path.join(dir, "index.js"),
    'module.exports.activate = ctx => {\n  ctx.windows.create({ file: "blank.html", width: 200, height: 100, show: false });\n};\n'
  );
}

export default async function closeMainWindow(ctx) {
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
      // The eval's response may never arrive; the window is being destroyed.
      ctx.evalMain("window.close()").catch(() => {});
      await ctx.waitAppExit(15000);
    },
    20000
  );
}
