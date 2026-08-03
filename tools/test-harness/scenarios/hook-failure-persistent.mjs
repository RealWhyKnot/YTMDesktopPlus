// Persistent variant of the hook-failure scenario: the break survives view
// recreation, so Retry must land back in the same failure state instead of
// silently hanging.

export const env = { YTMD_TEST_BREAK_HOOKS: "store-hook" };
export const expectedTripwires = ["hook-failed"];

export default async function hookFailurePersistent(ctx) {
  await ctx.step("hook failure reported", () => ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoadingError')", error => error === true, 120000), 125000);

  await ctx.step(
    "retry fails identically",
    async () => {
      await ctx.evalMain("document.querySelector('.ytmview-loading-retry').click()");
      // The error flag clears while the fresh view loads, then trips again
      // when its polls exhaust.
      await ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoadingError')", error => error === false, 30000);
      await ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoadingError')", error => error === true, 120000);
    },
    155000
  );
}
