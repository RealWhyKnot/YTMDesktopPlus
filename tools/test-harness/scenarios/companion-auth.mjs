// Exercises the companion server authorization flow: code request, native
// approval window, token issuance, and an authenticated request.

import { obtainCompanionToken } from "./lib.mjs";

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
}
