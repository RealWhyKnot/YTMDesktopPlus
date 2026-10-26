import { hooksReadyStep } from "./lib.mjs";

export const inspectMain = true;
export const fixture = {
  general: { startMinimized: true },
  state: { windowMaximized: true },
  integrations: { companionServerEnabled: false, discordPresenceEnabled: false, lastFMEnabled: false }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MAIN = `process.mainModule.require("electron").BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("windows/main/index.html"))`;

export default async function startMinimized(ctx) {
  await hooksReadyStep(ctx);

  await ctx.step(
    "main window stays hidden after it loads",
    async () => {
      for (let check = 0; check < 5; check++) {
        const visible = await ctx.evalMainProcess(`${MAIN}.isVisible()`);
        if (visible !== false) throw new Error(`main window visible (${visible}) on check ${check}`);
        await sleep(1000);
      }
    },
    15000
  );

  await ctx.step("a second launch shows it and applies the saved maximize", async () => {
    await ctx.evalMainProcess(`(() => {
      const win = ${MAIN};
      globalThis.__maximizeCalls = 0;
      win.maximize = () => { globalThis.__maximizeCalls++; };
      process.mainModule.require("electron").app.emit("second-instance", {}, [], "");
      return true;
    })()`);
    await sleep(500);
    const after = await ctx.evalMainProcess(`({ visible: ${MAIN}.isVisible(), maximizeCalls: globalThis.__maximizeCalls })`);
    if (!after.visible) throw new Error("main window still hidden");
    if (after.maximizeCalls !== 1) throw new Error(`maximize called ${after.maximizeCalls} times`);
  });

  await ctx.step("hiding and showing again does not maximize twice", async () => {
    await ctx.evalMainProcess(`(() => { const win = ${MAIN}; win.hide(); win.show(); return true; })()`);
    await sleep(300);
    const calls = await ctx.evalMainProcess(`globalThis.__maximizeCalls`);
    if (calls !== 1) throw new Error(`maximize called ${calls} times`);
  });
}
