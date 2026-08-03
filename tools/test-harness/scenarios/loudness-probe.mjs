// Reads the playerConfig of a loaded track from live YouTube Music, confirming
// audioConfig.loudnessDb still exists, and checks the loudness normalization
// gain node reacts to it. Local diagnostic, reaches live YTM.

export const fixture = {
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false,
    loudnessNormalization: true
  }
};

const VIDEO_ID = "dQw4w9WgXcQ";

export default async function loudnessProbe(ctx) {
  await ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);

  await ctx.step("navigate to a track", () =>
    ctx.evalYtm(`document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: "${VIDEO_ID}" } } } }))`)
  );

  await ctx.step(
    "player config readable",
    async () => {
      const deadline = Date.now() + 60000;
      let last = null;
      while (Date.now() < deadline) {
        last = await ctx.evalYtm(
          `JSON.stringify(document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerResponse?.()?.playerConfig ?? null)`
        );
        if (last && last !== "null") {
          ctx.emit("probe", { playerConfig: JSON.parse(last) });
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw new Error(`player config never appeared: ${last}`);
    },
    65000
  );

  await ctx.step(
    "gain node tracks the measured loudness",
    async () => {
      const deadline = Date.now() + 30000;
      let last = null;
      while (Date.now() < deadline) {
        last = await ctx.evalYtm(
          `JSON.stringify({
            gain: window.__ytmdLoudnessNormalization?.gain?.gain?.value ?? null,
            loudnessDb: document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerResponse?.()?.playerConfig?.audioConfig?.loudnessDb ?? null
          })`
        );
        const parsed = JSON.parse(last);
        if (parsed.gain !== null && parsed.loudnessDb !== null) {
          const expected = parsed.loudnessDb > 0 ? Math.pow(10, -parsed.loudnessDb / 20) : 1;
          if (Math.abs(parsed.gain - expected) < 0.05) {
            ctx.emit("probe", { gain: parsed.gain, loudnessDb: parsed.loudnessDb, expected });
            return;
          }
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw new Error(`gain never settled: ${last}`);
    },
    35000
  );
}
