export const env = { YTMD_TEST_YTM_FLAGS: "music_web_enable_wiz_miniplayer=true" };

export default async function miniplayerExperiment(ctx) {
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

  await ctx.step(
    "page bucketed into the experiment",
    () => ctx.waitMainLog(/YTM experiment flags music_web_enable_wiz_miniplayer=true injected/, 60000),
    65000
  );

  await ctx.step(
    "experiment pinned off",
    () => ctx.waitMainLog(/contract miss: experiment flag music_web_enable_wiz_miniplayer pinned to false/, 60000),
    65000
  );

  await ctx.step(
    "player api ready",
    () =>
      ctx.waitYtm(
        "(() => { try { return !!document.querySelector('ytmusic-app-layout>ytmusic-player-bar')?.playerApi?.isReady?.(); } catch { return false; } })()",
        ready => ready === true,
        90000
      ),
    95000
  );

  await ctx.step("classic player bar, no miniplayer", async () => {
    const layout = await ctx.evalYtm(
      "(() => ({ miniplayer: !!document.querySelector('ytmusic-miniplayer'), appFlag: document.querySelector('ytmusic-app')?.isMiniplayerEnabled ?? null, served: ytcfg.get('EXPERIMENT_FLAGS', {}).music_web_enable_wiz_miniplayer }))()"
    );
    if (layout.miniplayer || layout.appFlag !== false || layout.served !== false) throw new Error(`miniplayer layout leaked: ${JSON.stringify(layout)}`);
  });

  await ctx.step(
    "loading overlay clears",
    async () => {
      await ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoading')", loading => loading === false, 60000);
      const error = await ctx.evalMain("window.ytmd.memoryStore.get('ytmViewLoadingError')");
      if (error !== false) throw new Error(`ytmViewLoadingError=${error}`);
    },
    65000
  );
}
