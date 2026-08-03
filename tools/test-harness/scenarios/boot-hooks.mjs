// The core health check: the app boots, the YTM view hooks into the live
// page, and the loading overlay clears. This is also the scenario a scheduled
// canary runs to detect YouTube Music changing its internals.

export default async function bootHooks(ctx) {
  await ctx.step(
    "ytm view appears",
    async () => {
      const target = await ctx.waitTarget(ctx.patterns.YTM_VIEW, 60000);
      if (/consent\.youtube\.com|accounts\.google\.com/.test(target.url)) {
        ctx.environmentBlocked(`consent or sign-in wall: ${target.url.slice(0, 80)}`);
      }
    },
    65000
  );

  await ctx.step("store hook installs", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);

  await ctx.step("player api ready", () => ctx.waitYtm("(() => { try { return !!document.querySelector('ytmusic-app-layout>ytmusic-player-bar')?.playerApi?.isReady?.(); } catch { return false; } })()", ready => ready === true, 90000), 95000);

  await ctx.step(
    "loading overlay clears",
    async () => {
      await ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoading')", loading => loading === false, 60000);
      const error = await ctx.evalMain("window.ytmd.memoryStore.get('ytmViewLoadingError')");
      if (error !== false) throw new Error(`ytmViewLoadingError=${error}`);
    },
    65000
  );

  await ctx.step("hook stages logged", () => ctx.waitMainLog(/hook stage store-hook: done=true/, 15000), 20000);
}
