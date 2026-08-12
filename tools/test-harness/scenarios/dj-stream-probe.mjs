import { hooksReadyStep, playbackFixture } from "./lib.mjs";
// Confirms the page can recover the full audio stream of the playing track:
// the player's own deciphered segment URLs stay fetchable with range and ump
// stripped, the response decodes to PCM, and the element volume carries the
// loudness attenuation the player response reports. The dj addon's shadow
// source depends on all three. Local diagnostic, reaches live YouTube Music.

export const fixture = {
  playback: playbackFixture()
};

const VIDEO_ID = "dQw4w9WgXcQ";

export default async function djStreamProbe(ctx) {
  await hooksReadyStep(ctx);

  await ctx.step(
    "a track is playing",
    async () => {
      await ctx.evalYtm(`document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: "${VIDEO_ID}" } } } }))`);
      await ctx.waitYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerState?.() ?? null`, state => state === 1, 120000);
      // Muting the element keeps the run silent without touching the volume
      // values the loudness step reads.
      await ctx.evalYtm(`document.querySelector("video").muted = true`);
    },
    125000
  );

  await ctx.step(
    "player fetches audio segments",
    () =>
      ctx.waitYtm(
        `performance.getEntriesByType("resource").filter(e => /videoplayback/.test(e.name) && /mime=audio/.test(e.name)).length`,
        count => Number(count) > 0,
        30000
      ),
    35000
  );

  await ctx.step(
    "full stream fetch decodes",
    async () => {
      const result = JSON.parse(
        await ctx.evalYtm(
          `(async () => {
            const entries = performance.getEntriesByType("resource").filter(e => /videoplayback/.test(e.name) && /mime=audio/.test(e.name));
            const url = new URL(entries[entries.length - 1].name);
            // range/rn/rbuf select one segment, ump wraps the body in UMP
            // framing; none of them are in sparams, so the stripped URL
            // returns the whole file as plain media.
            for (const p of ["range", "rn", "rbuf", "ump", "srfvp", "alr"]) url.searchParams.delete(p);
            const response = await fetch(url.toString(), { credentials: "omit" });
            if (!response.ok) return JSON.stringify({ error: "http " + response.status });
            const buffer = await response.arrayBuffer();
            const bytes = buffer.byteLength;
            const context = new AudioContext();
            try {
              const decoded = await context.decodeAudioData(buffer);
              const video = document.querySelector("video");
              return JSON.stringify({
                bytes,
                contentType: response.headers.get("content-type"),
                decodedSeconds: decoded.duration,
                sampleRate: decoded.sampleRate,
                channels: decoded.numberOfChannels,
                elementSeconds: video ? video.duration : null
              });
            } catch (err) {
              return JSON.stringify({ error: "decode: " + String(err) });
            } finally {
              await context.close();
            }
          })()`
        )
      );
      ctx.emit("probe", result);
      if (result.error) throw new Error(result.error);
      if (!(result.decodedSeconds > 0)) throw new Error(`empty decode: ${JSON.stringify(result)}`);
      if (result.elementSeconds && Math.abs(result.decodedSeconds - result.elementSeconds) > 10)
        throw new Error(`decoded ${result.decodedSeconds}s but element reports ${result.elementSeconds}s`);
    },
    60000
  );

  await ctx.step(
    "element volume carries the reported loudness",
    async () => {
      const result = JSON.parse(
        await ctx.evalYtm(
          `(async () => {
            const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
            const response = bar?.playerApi?.getPlayerResponse?.();
            const loudnessDb = response?.playerConfig?.audioConfig?.loudnessDb;
            if (typeof loudnessDb !== "number") return JSON.stringify({ skipped: "no loudnessDb on player response" });
            bar.playerApi.setVolume(100);
            await new Promise(resolve => setTimeout(resolve, 300));
            const video = document.querySelector("video");
            return JSON.stringify({
              loudnessDb,
              expected: Math.min(1, Math.pow(10, -loudnessDb / 20)),
              elementVolume: video.volume
            });
          })()`
        )
      );
      ctx.emit("probe", result);
      if (result.skipped) return;
      if (Math.abs(result.elementVolume - result.expected) > 0.01)
        throw new Error(`element volume ${result.elementVolume}, loudness predicts ${result.expected}`);
    },
    15000
  );
}
