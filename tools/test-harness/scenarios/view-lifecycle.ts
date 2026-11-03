import { readFileSync } from "node:fs";
import path from "node:path";
import type { HarnessContext } from "../run.ts";
import { numberValue, record } from "../values.ts";
import { hooksReadyStep } from "./lib.ts";

const isInspectMain = true;
export { isInspectMain as inspectMain };
export const fixture = {
  general: { hideToTrayOnClose: false },
  state: { windowMaximized: false },
  integrations: { companionServerEnabled: false, discordPresenceEnabled: false, lastFMEnabled: false },
};

const VIEW_CONTEXT = `
  const { BrowserWindow } = process.mainModule.require("electron");
  const window = BrowserWindow.getAllWindows().find(candidate => candidate.webContents.getURL().includes("windows/main/index.html"));
  if (!window) throw new Error("Main window is missing");
  const view = window.contentView.children.find(child => child.webContents?.getURL().startsWith("https://music.youtube.com/"));
  if (!view) throw new Error("YTM view is not attached");
`;

const VIEW_SNAPSHOT = `(() => {
  ${VIEW_CONTEXT}
  return {
    ownerMatches: BrowserWindow.fromWebContents(view.webContents) === window,
    windowBounds: window.getBounds(),
    contentBounds: window.getContentBounds(),
    viewBounds: view.getBounds()
  };
})()`;

function checkSnapshot(value: unknown) {
  const snapshot = record(value);
  if (snapshot.ownerMatches !== true) throw new Error("YTM web contents do not belong to the main window");
  const bounds = record(snapshot.viewBounds);
  const content = record(snapshot.contentBounds);
  const expected = { x: 0, y: 36, width: numberValue(content.width), height: numberValue(content.height) - 36 };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (bounds[key] !== expectedValue) throw new Error(`YTM view ${key}: expected ${expectedValue}, received ${JSON.stringify(bounds[key])}`);
  }
  return snapshot;
}

async function viewLifecycle(ctx: HarnessContext) {
  await hooksReadyStep(ctx);
  await ctx.step(
    "view is attached with the main window as owner",
    async () => {
      await ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoading')", (loading) => loading === false, 60000);
      const snapshot = checkSnapshot(await ctx.evalMainProcess(VIEW_SNAPSHOT));
      ctx.emit("view-lifecycle", { stage: "attached", ...snapshot });
    },
    65000
  );

  await ctx.step("view follows the main window size", async () => {
    const before = checkSnapshot(await ctx.evalMainProcess(VIEW_SNAPSHOT));
    const original = record(before.windowBounds);
    const resized = { ...original, width: numberValue(original.width) + 48, height: numberValue(original.height) + 32 };
    try {
      await ctx.evalMainProcess(`new Promise((resolve, reject) => {
        ${VIEW_CONTEXT}
        const deadline = Date.now() + 5000;
        window.setBounds(${JSON.stringify(resized)});
        const check = () => {
          const content = window.getContentBounds();
          const bounds = view.getBounds();
          if (bounds.x === 0 && bounds.y === 36 && bounds.width === content.width && bounds.height === content.height - 36) {
            resolve(true);
          } else if (Date.now() >= deadline) {
            reject(new Error("YTM view did not follow the resized window"));
          } else {
            setTimeout(check, 25);
          }
        };
        check();
      })`);
      const after = checkSnapshot(await ctx.evalMainProcess(VIEW_SNAPSHOT));
      const changed = record(after.contentBounds);
      const previous = record(before.contentBounds);
      if (changed.width === previous.width || changed.height === previous.height) throw new Error("Main window size did not change on both axes");
      ctx.emit("view-lifecycle", { stage: "resized", before, after });
    } finally {
      await ctx.evalMainProcess(`(() => { ${VIEW_CONTEXT} window.setBounds(${JSON.stringify(original)}); return true; })()`);
    }
  });

  await ctx.step(
    "closing the window destroys the page",
    async () => {
      const evidenceFile = path.join(ctx.runDir, "view-close.json");
      await ctx.evalMainProcess(`(() => {
      ${VIEW_CONTEXT}
      const fs = process.mainModule.require("node:fs");
      const state = { windowClosed: false, pageDestroyed: false };
      const save = () => fs.writeFileSync(${JSON.stringify(evidenceFile)}, JSON.stringify(state));
      window.once("closed", () => { state.windowClosed = true; save(); });
      view.webContents.once("destroyed", () => { state.pageDestroyed = true; save(); });
      save();
      return true;
    })()`);
      void ctx.evalMain("window.close()").catch((error: unknown) => console.warn("Window close ended the renderer connection", error));
      await ctx.waitAppExit(15000);
      const evidence = record(JSON.parse(readFileSync(evidenceFile, "utf8")));
      if (evidence.windowClosed !== true || evidence.pageDestroyed !== true) throw new Error(`Window/page close evidence: ${JSON.stringify(evidence)}`);
      ctx.emit("view-lifecycle", { stage: "closed", ...evidence });
    },
    20000
  );
}

export { viewLifecycle as runScenario };
