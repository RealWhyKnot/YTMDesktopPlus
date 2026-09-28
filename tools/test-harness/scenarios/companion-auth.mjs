// Exercises the companion server authorization flow: code request, native
// approval window, token issuance, and an authenticated request.

import { obtainCompanionToken } from "./lib.mjs";

const SETTINGS_WINDOW = /windows\/settings\//;

export const needsCompanion = true;
export const fixture = {
  integrations: {
    companionServerEnabled: true,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false
  }
};

export default async function companionAuth(ctx) {
  let token;
  await ctx.step(
    "authorization flow issues token",
    async () => {
      token = await obtainCompanionToken(ctx);
    },
    90000
  );

  await ctx.step("token grants api access", async () => {
    const state = await ctx.companion.request("/api/v1/state", { token });
    if (state.status !== 200) throw new Error(`state returned ${state.status}`);
    if (!state.body || typeof state.body.player !== "object") throw new Error("state body missing player");
  });

  await ctx.step("auth window flag auto-disables", async () => {
    const enabled = await ctx.evalMain("window.ytmd.memoryStore.get('companionServerAuthWindowEnabled')");
    if (enabled !== false) throw new Error(`companionServerAuthWindowEnabled=${enabled}`);
  });

  await ctx.step(
    "a token revoked from settings is refused",
    async () => {
      await ctx.evalMain("window.ytmd.openSettingsWindow()");
      await ctx.waitTarget(SETTINGS_WINDOW, 15000);
      await ctx.waitOnTarget(SETTINGS_WINDOW, "typeof window.ytmd?.safeStorage?.encryptString", kind => kind === "function", 15000);
      await ctx.evalOnTarget(
        SETTINGS_WINDOW,
        `window.ytmd.safeStorage.encryptString("[]").then(value => window.ytmd.store.set("integrations.companionServerAuthTokens", value))`
      );
      const deadline = Date.now() + 5000;
      for (;;) {
        const state = await ctx.companion.request("/api/v1/state", { token });
        if (state.status === 401) return;
        if (Date.now() > deadline) throw new Error(`revoked token still gets ${state.status}`);
        await new Promise(r => setTimeout(r, 200));
      }
    },
    45000
  );
}
