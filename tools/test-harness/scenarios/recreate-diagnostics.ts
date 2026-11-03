import { record } from "../values.ts";
import type { HarnessContext } from "../run.ts";
async function recreateDiagnostics(ctx: HarnessContext) {
  await ctx.step("initial hooks healthy", () => ctx.waitYtm("!!window.__YTMD_HOOK__", (hooked) => hooked === true, 90000), 95000);

  await ctx.step("recreate view", () => ctx.evalMain("window.ytmd.ytmViewRecreate()"));

  await ctx.step(
    "inspect recreated view",
    async () => {
      await new Promise((r) => setTimeout(r, 20000));
      const snapshot = await ctx.evalYtm(`(() => {
        const descriptor = Object.getOwnPropertyDescriptor(window, "PolymerFakeBaseClassWithoutHtml");
        const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
        return {
          trap: descriptor ? { hasGet: !!descriptor.get, hasSet: !!descriptor.set, isData: "value" in descriptor, valueType: typeof descriptor.value } : null,
          hook: !!window.__YTMD_HOOK__,
          readyState: document.readyState,
          navigationType: performance.getEntriesByType("navigation")[0]?.type ?? null,
          playerBarPresent: !!playerBar,
          playerApiReady: (() => { try { return !!playerBar?.playerApi?.isReady?.(); } catch { return false; } })(),
          title: document.title.slice(0, 60)
        };
      })()`);
      ctx.emit("recreate-snapshot", record(snapshot));

      await new Promise((r) => setTimeout(r, 20000));
      const later = await ctx.evalYtm("({ hook: !!window.__YTMD_HOOK__, readyState: document.readyState })");
      ctx.emit("recreate-snapshot-later", record(later));
    },
    60000
  );
}

export { recreateDiagnostics as runScenario };
