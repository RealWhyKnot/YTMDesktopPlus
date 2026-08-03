// Exercises the companion REST API surface beyond authorization: state shape,
// command dispatch, and rejection of invalid input.

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

export default async function companionApi(ctx) {
  let token;
  await ctx.step(
    "obtain token",
    async () => {
      token = await obtainCompanionToken(ctx);
    },
    90000
  );

  await ctx.step("metadata lists api v1", async () => {
    const res = await ctx.companion.request("/metadata");
    if (res.status !== 200 || !res.body?.apiVersions?.includes("v1")) {
      throw new Error(`metadata: ${res.status} ${JSON.stringify(res.body)}`);
    }
  });

  await ctx.step("state has expected shape", async () => {
    const res = await ctx.companion.request("/api/v1/state", { token });
    if (res.status !== 200) throw new Error(`state returned ${res.status}`);
    for (const key of ["player", "video"]) {
      if (!(key in res.body)) throw new Error(`state missing '${key}'`);
    }
  });

  await ctx.step("valid command accepted", async () => {
    const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "playPause" } });
    if (res.status !== 204) throw new Error(`playPause returned ${res.status}`);
  });

  await ctx.step("invalid command rejected", async () => {
    const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "notARealCommand" } });
    if (res.status < 400) throw new Error(`invalid command returned ${res.status}`);
  });

  await ctx.step("unauthenticated request rejected", async () => {
    const res = await ctx.companion.request("/api/v1/state");
    if (res.status < 400) throw new Error(`unauthenticated state returned ${res.status}`);
  });
}
