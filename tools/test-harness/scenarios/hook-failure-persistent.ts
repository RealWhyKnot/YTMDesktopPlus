import type { HarnessContext } from "../run.ts";
export const env = { YTMD_TEST_BREAK_HOOKS: "store-hook" };
export const expectedTripwires = ["hook-failed"];

async function hookFailurePersistent(ctx: HarnessContext) {
  await ctx.step("hook failure reported", () => ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoadingError')", (error) => error === true, 120000), 125000);

  await ctx.step(
    "retry fails identically",
    async () => {
      await ctx.evalMain("document.querySelector('.ytmview-loading-retry').click()");

      await ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoadingError')", (error) => error === false, 30000);
      await ctx.waitMain("window.ytmd.memoryStore.get('ytmViewLoadingError')", (error) => error === true, 120000);
    },
    155000
  );
}

export { hookFailurePersistent as runScenario };
