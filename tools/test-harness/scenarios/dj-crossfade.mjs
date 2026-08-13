import { rmSync } from "node:fs";
import path from "node:path";
import { hooksReadyStep, playbackFixture } from "./lib.mjs";
// Runs the dj addon's crossfade against a real track end: the engine prepares
// the tail inside the lead window, starts an overlap when the fade window
// arrives, the player moves to the next track and the gain comes back to
// full. Local diagnostic, reaches live YouTube Music.
//
// Playback start depends on the signed-in account's server-side session
// restore and on how recently the account played the probe tracks; rapid
// repeated runs can leave the player refusing to start entirely. Space runs
// out, and prefer a freshly settled seed profile (boot the dev profile once
// and close it cleanly before seeding).

export const fixture = {
  playback: playbackFixture(),
  addons: { states: { dj: { enabled: true } } }
};

// A seeded profile carries the previous session's parked player state in web
// storage, which can leave the player refusing watch navigation on a cold
// boot. Dropping site storage keeps the cookie login and wakes the player
// clean.
export async function prepareProfile(profileDir) {
  for (const dir of ["Local Storage", "Session Storage", "IndexedDB"]) {
    rmSync(path.join(profileDir, dir), { recursive: true, force: true });
  }
}

// Two interchangeable long-lived tracks for when the run has to pick a
// target itself.
const TRACK_IDS = ["dQw4w9WgXcQ", "kJQP7kiw5Fk"];

export default async function djCrossfade(ctx) {
  await hooksReadyStep(ctx);

  await ctx.step("player silenced before anything plays", async () => {
    await ctx.evalYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.setVolume?.(2)`);
    await ctx.evalYtm(`{ const v = document.querySelector("video"); if (v) v.muted = true; }`);
  });

  // The signed-in account can restore its last watch state from the server at
  // any moment around boot, and watch navigation is swallowed while that
  // restore is in flight. Resuming the restored track is always accepted, so
  // when one is parked it becomes the run's target; navigation only happens
  // on a clean boot.
  let target = TRACK_IDS[0];
  await ctx.step(
    "a track is playing",
    async () => {
      const parked = await ctx.evalYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getVideoData?.()?.video_id ?? null`);
      if (parked) {
        target = parked;
        await ctx.evalYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.playVideo()`);
      } else {
        target = TRACK_IDS[0];
        await ctx.evalYtm(
          `document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: "${TRACK_IDS[0]}" } } } }))`
        );
      }
      ctx.emit("probe", { parked, target });
      await ctx.waitYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerState?.() ?? null`, state => state === 1, 120000);
      await ctx.evalYtm(`document.querySelector("video").muted = true`);
    },
    125000
  );

  await ctx.step(
    "queue offers a next track",
    async () => {
      const other = TRACK_IDS.find(id => id !== target);
      const aheadExpr = `(() => { const q = window.__YTMD_HOOK__?.ytmStore?.getState()?.queue; return q ? q.items.length - 1 - q.selectedItemIndex : -1; })()`;
      // The organic radio queue is the best next track when autoplay kicks in.
      // When it does not (the autoplay preference lived in the storage
      // prepareProfile dropped), append the current item cloned with every
      // embedded reference rewritten to the other track, endpoints included.
      try {
        await ctx.waitYtm(aheadExpr, ahead => Number(ahead) > 0, 8000);
        return;
      } catch {
        // No radio; synthesize the next item.
      }
      await ctx.evalYtm(`(() => {
        const store = window.__YTMD_HOOK__.ytmStore;
        const queue = store.getState().queue;
        if (queue.items.length - 1 - queue.selectedItemIndex > 0) return;
        const current = queue.items[queue.selectedItemIndex] ?? queue.items[0];
        const clone = JSON.parse(JSON.stringify(current).split("${target}").join("${other}"));
        store.dispatch({
          type: "ADD_ITEMS",
          payload: {
            nextQueueItemId: queue.nextQueueItemId,
            index: queue.items.length,
            items: [clone],
            shuffleEnabled: false,
            shouldAssignIds: true
          }
        });
      })()`);
      await ctx.waitYtm(aheadExpr, ahead => Number(ahead) > 0, 20000);
    },
    30000
  );

  await ctx.step("engine attached", () => ctx.waitYtm(`!!window.__ytmdDjCrossfade`, attached => attached === true, 15000), 20000);

  await ctx.step(
    "tail prepared inside the lead window",
    async () => {
      await ctx.evalYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.seekTo(document.querySelector("video").duration - 23)`);
      await ctx.waitYtm(`!!window.__ytmdDjCrossfade?.prep?.tail`, ready => ready === true, 45000);
    },
    50000
  );

  await ctx.step(
    "overlap runs and the next track fades in",
    async () => {
      await ctx.evalYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.seekTo(document.querySelector("video").duration - 5)`);
      await ctx.waitYtm(
        `JSON.stringify((() => {
          const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
          const queue = window.__YTMD_HOOK__?.ytmStore?.getState()?.queue;
          const video = document.querySelector("video");
          return {
            overlaps: window.__ytmdDjCrossfade?.overlapCount ?? 0,
            videoId: bar?.playerApi?.getVideoData?.()?.video_id ?? null,
            playerState: bar?.playerApi?.getPlayerState?.() ?? null,
            queueItems: queue?.items?.length ?? null,
            queueIndex: queue?.selectedItemIndex ?? null,
            remaining: video ? Math.round((video.duration - video.currentTime) * 10) / 10 : null
          };
        })())`,
        raw => {
          const status = JSON.parse(raw);
          return status.overlaps >= 1 && status.videoId && status.videoId !== target;
        },
        45000
      );
      const status = JSON.parse(
        await ctx.evalYtm(
          `JSON.stringify({
            overlaps: window.__ytmdDjCrossfade.overlapCount,
            phase: window.__ytmdDjCrossfade.phase,
            videoId: document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.getVideoData().video_id
          })`
        )
      );
      ctx.emit("probe", status);
    },
    60000
  );

  await ctx.step(
    "gain settles back at full",
    () => ctx.waitYtm(`window.__ytmdAudioGraph?.out?.gain?.value ?? null`, value => typeof value === "number" && value > 0.95, 20000),
    25000
  );
}
