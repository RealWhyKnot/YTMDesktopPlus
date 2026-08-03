// Forces the store hook stage to fail once, then verifies the failure is
// reported (log line, error state, retry button) and that Retry recovers with
// a fresh view.

export const env = { YTMD_TEST_BREAK_HOOKS: "store-hook:once" };
export const expectedTripwires = ["hook-failed"];

export default async function hookFailure(ctx) {
  await ctx.step("hook failure reported", () => ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoadingError')", error => error === true, 120000), 125000);

  await ctx.step("failure logged with stage", () => ctx.waitMainLog(/hook failed at stage 'store-hook'/, 10000), 15000);

  await ctx.step("retry button visible", async () => {
    const visible = await ctx.evalMain("!!document.querySelector('.ytmview-loading-retry')");
    if (!visible) throw new Error("retry button not rendered");
  });

  await ctx.step(
    "retry recovers",
    async () => {
      await ctx.evalMain("document.querySelector('.ytmview-loading-retry').click()");
      await ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoading')", loading => loading === false, 120000);
      const error = await ctx.evalMain("window.ytmd.memoryStore.get('ytmViewLoadingError')");
      if (error !== false) throw new Error(`ytmViewLoadingError=${error} after retry`);
      await ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 30000);
    },
    155000
  );
}
