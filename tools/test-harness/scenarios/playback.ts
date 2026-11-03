import { responseBody } from "../companion-values.ts";
import type { HarnessContext } from "../run.ts";
import { hooksReadyStep, obtainCompanionToken } from "./lib.ts";

export const needsCompanion = true;
export const fixture = {
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false,
    adBlockerEnabled: false,

    preventIdlePause: true,
  },
  integrations: {
    companionServerEnabled: true,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false,
  },
};

const VIDEO_ID = "dQw4w9WgXcQ";

async function playback(ctx: HarnessContext) {
  let token: string | undefined;
  await ctx.step(
    "obtain token",
    async () => {
      token = await obtainCompanionToken(ctx);
    },
    90000
  );

  await hooksReadyStep(ctx);

  await ctx.step("changeVideo accepted", async () => {
    const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "changeVideo", data: { videoId: VIDEO_ID } } });
    if (res.status !== 204) throw new Error(`changeVideo returned ${res.status}`);
  });

  await ctx.step(
    "video loads and reports state",
    async () => {
      let last = null;
      for (let attempt = 1; attempt <= 6; attempt++) {
        if (attempt > 1 && last?.video?.id !== VIDEO_ID) {
          ctx.emit("probe-change-video-retry", { attempt, video: last?.video?.id ?? null });
          const retry = await ctx.companion.request("/api/v1/command", {
            method: "POST",
            token,
            body: { command: "changeVideo", data: { videoId: VIDEO_ID } },
          });
          if (retry.status !== 204) throw new Error(`changeVideo returned ${retry.status}`);
        }
        for (let poll = 0; poll < 3; poll++) {
          await new Promise((r) => setTimeout(r, 5000));
          const res = await ctx.companion.request("/api/v1/state", { token });
          if (res.status !== 200) continue;
          last = responseBody(res.body);
          const isVideoLoaded = responseBody(res.body)?.video?.id === VIDEO_ID;
          const isProgressing = last?.player?.trackState === 1 && last.player.adPlaying !== true && (last.player.videoProgress ?? 0) > 0;
          if (isVideoLoaded && isProgressing) return;
        }
      }
      throw new Error(
        `video never progressed: state=${last?.player?.trackState}, ad=${last?.player?.adPlaying}, progress=${last?.player?.videoProgress}, video=${last?.video?.id}`
      );
    },
    115000
  );

  async function commandReachesState(command: string, trackState: number, timeout: number) {
    const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command } });
    if (res.status !== 204) throw new Error(`${command} returned ${res.status}`);

    const deadline = Date.now() + timeout;
    let last = null;
    while (Date.now() < deadline) {
      const state = await ctx.companion.request("/api/v1/state", { token });
      const player = responseBody(state.body)?.player;
      last = { status: state.status, trackState: player?.trackState, adPlaying: player?.adPlaying, progress: player?.videoProgress };
      if (last.trackState === trackState) return;
      await new Promise((r) => setTimeout(r, 3000));
    }
    throw new Error(`${command} never reached trackState ${trackState}: ${JSON.stringify(last)}`);
  }

  await ctx.step("pause takes effect while the view is idle", () => commandReachesState("pause", 0, 20000), 25000);
  await ctx.step("play resumes after the pause", () => commandReachesState("play", 1, 20000), 25000);
  await ctx.step("record native thumbnail dimensions", async () => {
    const thumbnails = await ctx.evalYtm(`(() => {
      const details = document.querySelector('ytmusic-app-layout>ytmusic-player-bar')?.playerApi?.getPlayerResponse?.()?.videoDetails;
      return (details?.thumbnail?.thumbnails ?? []).map(item => ({ width: item.width, height: item.height, valid: Number.isFinite(item.width) && Number.isFinite(item.height) }));
    })()`);
    ctx.emit("native-thumbnail-dimensions", { thumbnails });
  });
}

export { playback as runScenario };
