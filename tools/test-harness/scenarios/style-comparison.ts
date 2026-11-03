import type { HarnessContext } from "../run.ts";
import { array, stringValue } from "../values.ts";
import { captureStyles, setReducedMotion } from "../style-snapshot.ts";
import { hooksReadyStep } from "./lib.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { collectProjectCss, replaceProjectCss } from "../style-sheets.ts";

const isInspectMain = true;
export { isInspectMain as inspectMain };
export const env = { YTMD_TEST_CAPTURE_CSS: "1" };
export const fixture = {
  general: { hideToTrayOnClose: false },
  state: { windowMaximized: false, windowBounds: { x: 0, y: 0, width: 1100, height: 800 } },
  integrations: { companionServerEnabled: false, discordPresenceEnabled: false, lastFMEnabled: false },
  themes: { active: null },
  addons: {
    states: { "mobile-bridge": { enabled: true }, "volume-boost": { enabled: true }, blend: { enabled: true } },
    settings: { "mobile-bridge": { discordMirrorEnabled: false }, rooms: { autoRoomEnabled: false, audioStreamEnabled: false } },
  },
};

const SETTINGS_WINDOW = /windows\/settings\//;
const ROOM_WINDOW = /windows\/room\//;

async function styleComparison(ctx: HarnessContext) {
  if (process.argv.includes("--css-only")) {
    await hooksReadyStep(ctx);
    const css = await ctx.step("collect applied project stylesheets", () => collectProjectCss(ctx));
    const comparisonIndex = process.argv.indexOf("--compare-css");
    const comparisonFile = comparisonIndex >= 0 ? process.argv[comparisonIndex + 1] : undefined;
    if (comparisonFile) {
      for (const state of ["before", "after"]) {
        if (state === "after") await replaceProjectCss(ctx, css, comparisonFile);
        const captureDirectory = path.join(ctx.runDir, state);
        mkdirSync(captureDirectory, { recursive: true });
        await ctx.step(
          `capture same page ${state}`,
          async () => {
            for (const isReduced of [false, true]) {
              await setReducedMotion(ctx, ctx.patterns.YTM_VIEW, isReduced);
              await captureStyles({ ...ctx, runDir: captureDirectory }, ctx.patterns.YTM_VIEW, `ytm-${isReduced ? "reduced" : "normal"}`);
            }
          },
          240000
        );
      }
    }
    return;
  }
  await ctx.step("open settings for style capture", async () => {
    await ctx.evalMain("window.ytmd.openSettingsWindow()");
    await ctx.waitTarget(SETTINGS_WINDOW, 20000);
    await ctx.waitOnTarget(SETTINGS_WINDOW, "document.querySelectorAll('[role=tab]').length", (count) => count === 8, 20000);
  });

  const tabs = array(await ctx.evalOnTarget(SETTINGS_WINDOW, "[...document.querySelectorAll('[role=tab]')].map(tab => tab.id)")).map(stringValue);
  for (const isReduced of [false, true]) {
    const mode = isReduced ? "reduced" : "normal";
    await setReducedMotion(ctx, SETTINGS_WINDOW, isReduced);
    for (const tab of tabs) {
      await ctx.step(`capture ${tab} ${mode}`, async () => {
        await ctx.evalOnTarget(SETTINGS_WINDOW, `document.getElementById(${JSON.stringify(tab)}).click(); true`);
        await ctx.waitOnTarget(
          SETTINGS_WINDOW,
          `document.getElementById(${JSON.stringify(tab)}).getAttribute('aria-selected')`,
          (value) => value === "true",
          5000
        );
        await captureStyles(ctx, SETTINGS_WINDOW, `${tab}-${mode}`);
      });
    }
  }

  await ctx.step("capture integrations table", async () => {
    await ctx.evalOnTarget(SETTINGS_WINDOW, "document.getElementById('settings-tab-integrations').click(); true");
    await ctx.waitOnTarget(SETTINGS_WINDOW, "!!document.querySelector('.integrations-tab')", (value) => value === true, 5000);
    await ctx.evalOnTarget(SETTINGS_WINDOW, "document.querySelector('.integrations-tab input[type=checkbox]').click(); true");
    await ctx.waitOnTarget(SETTINGS_WINDOW, "!!document.querySelector('.no-authorized-companions')", (value) => value === true, 5000);
    await setReducedMotion(ctx, SETTINGS_WINDOW, false);
    await captureStyles(ctx, SETTINGS_WINDOW, "integrations-expanded-normal");
    await setReducedMotion(ctx, SETTINGS_WINDOW, true);
    await captureStyles(ctx, SETTINGS_WINDOW, "integrations-expanded-reduced");
    const trial = await ctx.evalOnTarget(
      SETTINGS_WINDOW,
      `(() => {
      const original = document.querySelector('.no-authorized-companions td');
      if (!original) return { changed: false };
      const elements = [...document.querySelectorAll('*')];
      const bounds = () => elements.map(element => {
        const rect = element.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height];
      });
      const properties = element => {
        const style = getComputedStyle(element);
        return Object.fromEntries([...style].map(name => [name, style.getPropertyValue(name)]));
      };
      const before = bounds();
      const oldStyle = properties(original);
      const replacement = document.createElement('span');
      replacement.textContent = original.textContent;
      replacement.style.cssText = 'display: table-cell; padding: 1px; unicode-bidi: isolate';
      const index = elements.indexOf(original);
      original.replaceWith(replacement);
      elements[index] = replacement;
      const after = bounds();
      const newStyle = properties(replacement);
      const differences = Object.keys(oldStyle).filter(key => oldStyle[key] !== newStyle[key]).map(key => ({ property: key, old: oldStyle[key], new: newStyle[key] }));
      replacement.replaceWith(original);
      return { changed: true, before: before[index], after: after[index], movedElements: before.flatMap((value, index) => JSON.stringify(value) === JSON.stringify(after[index]) ? [] : [{ index, old: value, new: after[index] }]), differences };
    })()`
    );
    writeFileSync(path.join(ctx.runDir, "integrations-markup-trial.json"), JSON.stringify(trial));
    ctx.emit("integrations-markup-trial", { trial });
  });

  await ctx.step("capture room window", async () => {
    await ctx.evalMain("window.ytmd.openRoomWindow()");
    await ctx.waitTarget(ROOM_WINDOW, 15000);
    await ctx.waitOnTarget(ROOM_WINDOW, "!!document.querySelector('.room-container')", (value) => value === true, 10000);
    for (const isReduced of [false, true]) {
      await setReducedMotion(ctx, ROOM_WINDOW, isReduced);
      await captureStyles(ctx, ROOM_WINDOW, `room-${isReduced ? "reduced" : "normal"}`);
    }
  });

  await hooksReadyStep(ctx);
  await ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoading')", (value) => value === false, 60000);
  await ctx.step("capture loading screen", async () => {
    await ctx.evalMain("window.ytmd.memoryStore.set('ytmViewLoading', true); window.ytmd.memoryStore.set('ytmViewLoadingStatus', 'Initializing...'); true");
    await ctx.waitMain("document.querySelectorAll('.loader-line').length", (value) => value === 8, 5000);
    for (const isReduced of [false, true]) {
      await setReducedMotion(ctx, ctx.patterns.MAIN_WINDOW, isReduced);
      await captureStyles(ctx, ctx.patterns.MAIN_WINDOW, `loader-${isReduced ? "reduced" : "normal"}`);
    }
  });

  if (process.argv.includes("--app-only")) {
    ctx.emit("style-scope", { scope: "application windows only" });
    return;
  }
  await hooksReadyStep(ctx);
  await ctx.step("collect applied project stylesheets", () => collectProjectCss(ctx));
  await ctx.step(
    "capture default themed YTM",
    async () => {
      for (const isReduced of [false, true]) {
        await setReducedMotion(ctx, ctx.patterns.YTM_VIEW, isReduced);
        await captureStyles(ctx, ctx.patterns.YTM_VIEW, `ytm-${isReduced ? "reduced" : "normal"}`);
      }
    },
    180000
  );
}

export { styleComparison as runScenario };
