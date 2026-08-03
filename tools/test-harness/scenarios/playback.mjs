// Drives actual playback through companion commands. Local use, not suited to
// CI runners: it depends on signed-out playback being available, and ads can
// front-run the requested track (adPlaying counts as progress evidence).

import { obtainCompanionToken } from "./lib.mjs";

export const needsCompanion = true;
export const fixture = {
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false
  },
  integrations: {
    companionServerEnabled: true,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false
  }
};

// A long-standing public track.
const VIDEO_ID = "dQw4w9WgXcQ";

export default async function playback(ctx) {
  let token;
  await ctx.step("obtain token", async () => {
    token = await obtainCompanionToken(ctx);
  }, 90000);

  await ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);

  await ctx.step("changeVideo accepted", async () => {
    const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "changeVideo", data: { videoId: VIDEO_ID } } });
    if (res.status !== 204) throw new Error(`changeVideo returned ${res.status}`);
  });

  await ctx.step(
    "video loads and reports state",
    async () => {
      const deadline = Date.now() + 90000;
      let last = null;
      while (Date.now() < deadline) {
        const res = await ctx.companion.request("/api/v1/state", { token });
        last = res.body;
        const videoLoaded = res.body?.video?.id === VIDEO_ID;
        const progressing = res.body?.player?.trackState === 1 || res.body?.player?.adPlaying === true || (res.body?.player?.videoProgress ?? 0) > 0;
        if (videoLoaded && progressing) return;
        await new Promise(r => setTimeout(r, 3000));
      }
      throw new Error(`video never progressed: ${JSON.stringify(last?.player)} video=${JSON.stringify(last?.video?.id)}`);
    },
    95000
  );
}
