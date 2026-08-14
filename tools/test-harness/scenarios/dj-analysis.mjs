import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { hooksReadyStep, playbackFixture } from "./lib.mjs";
// Exercises the dj addon's analysis pipeline against a real track: the page
// ships the audio, the hidden dj-analysis window decodes and measures it, and
// a plausible feature record lands in the addon's database on disk. Playback
// start has the same account-state sensitivities as dj-crossfade; space runs
// out. Local diagnostic, reaches live YouTube Music.

export const fixture = {
  playback: playbackFixture(),
  addons: { states: { dj: { enabled: true } } }
};

export async function prepareProfile(profileDir) {
  for (const dir of ["Local Storage", "Session Storage", "IndexedDB"]) {
    rmSync(path.join(profileDir, dir), { recursive: true, force: true });
  }
}

const VIDEO_ID = "dQw4w9WgXcQ";

export default async function djAnalysis(ctx) {
  await hooksReadyStep(ctx);

  await ctx.step("player silenced before anything plays", async () => {
    await ctx.evalYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.setVolume?.(2)`);
    await ctx.evalYtm(`{ const v = document.querySelector("video"); if (v) v.muted = true; }`);
  });

  await ctx.step(
    "a track is playing",
    async () => {
      const parked = await ctx.evalYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getVideoData?.()?.video_id ?? null`);
      if (parked) await ctx.evalYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.playVideo()`);
      else await ctx.evalYtm(`document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: "${VIDEO_ID}" } } } }))`);
      await ctx.waitYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerState?.() ?? null`, state => state === 1, 120000);
      await ctx.evalYtm(`document.querySelector("video").muted = true`);
    },
    125000
  );

  await ctx.step("analysis window comes up after the catalog delay", () => ctx.waitTarget(/windows\/dj-analysis\//, 60000), 65000);

  await ctx.step(
    "a feature record lands in the database",
    async () => {
      const dbPath = path.join(ctx.profileDir, "addon-data", "dj", "features.json");
      const deadline = Date.now() + 90000;
      let db = null;
      while (Date.now() < deadline) {
        try {
          db = JSON.parse(readFileSync(dbPath, "utf8"));
          if (db.tracks && Object.keys(db.tracks).length > 0) break;
        } catch {
          // Not written yet.
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      const record = db?.tracks ? Object.values(db.tracks)[0] : null;
      if (!record) throw new Error("no feature record appeared");
      ctx.emit("probe", record);
      if (record.bpm != null && (record.bpm < 40 || record.bpm > 220)) throw new Error(`implausible bpm ${record.bpm}`);
      if (!(record.durationS > 30)) throw new Error(`implausible duration ${record.durationS}`);
      // The beat grid is what the blend runs on, so an analyzed track without
      // an offset is as useless as one without a tempo.
      if (record.bpm != null && record.beatOffsetS == null) throw new Error("tempo without a beat offset");
    },
    95000
  );
}
