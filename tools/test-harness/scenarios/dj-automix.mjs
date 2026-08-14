import { rmSync } from "node:fs";
import path from "node:path";
import { hooksReadyStep, playbackFixture } from "./lib.mjs";
// Answers the one question the crossfade scenario cannot: are two tracks
// actually audible at the same time?
//
// dj-crossfade force-mutes the media element, which makes startOverlap open the
// shadow at gain 0 - the code path runs but nothing overlaps. Here the element
// stays unmuted and silence comes from YTMD_TEST_MUTED, which mutes the
// webContents output while leaving the Web Audio graph running, so the shadow
// gain is a real measured level.
//
// Every seek goes through the track clock. YTM appends consecutive tracks into
// one MediaSource, so the element's currentTime and duration span the whole
// buffer and seeking off them lands in the wrong track.
//
// Reaches live YouTube Music. Space runs out; rapid repeats hit YT throttling.

export const fixture = {
  playback: playbackFixture(),
  addons: {
    states: { dj: { enabled: true } },
    settings: { dj: { fadeOut: 5, fadeIn: 1.5, curve: 0, fadeOnManualSkip: true, fadeOnRepeatOne: false, autoDj: true } }
  }
};

export async function prepareProfile(profileDir) {
  for (const dir of ["Local Storage", "Session Storage", "IndexedDB"]) {
    rmSync(path.join(profileDir, dir), { recursive: true, force: true });
  }
}

const TRACK_IDS = ["dQw4w9WgXcQ", "kJQP7kiw5Fk"];

const PLAYER_BAR = `document.querySelector("ytmusic-app-layout>ytmusic-player-bar")`;
const TRACK_POSITION = `(${PLAYER_BAR}?.playerApi?.getCurrentTime?.() ?? 0)`;
const TRACK_LENGTH = `Number(${PLAYER_BAR}?.playerApi?.getPlayerResponse?.()?.videoDetails?.lengthSeconds ?? 0)`;

export default async function djAutomix(ctx) {
  await hooksReadyStep(ctx);

  await ctx.step("output silenced at the process, not the element", async () => {
    // The element must stay unmuted or the shadow opens at gain 0 and there is
    // nothing to measure. YTMD_TEST_MUTED keeps the speakers quiet.
    await ctx.evalYtm(`${PLAYER_BAR}?.playerApi?.setVolume?.(5)`);
  });

  let target = TRACK_IDS[0];
  await ctx.step(
    "a track is playing",
    async () => {
      const parked = await ctx.evalYtm(`${PLAYER_BAR}?.playerApi?.getVideoData?.()?.video_id ?? null`);
      if (parked) {
        target = parked;
        await ctx.evalYtm(`${PLAYER_BAR}.playerApi.playVideo()`);
      } else {
        target = TRACK_IDS[0];
        await ctx.evalYtm(
          `document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: "${TRACK_IDS[0]}" } } } }))`
        );
      }
      ctx.emit("probe", { parked, target });
      // Nudge on every poll rather than once: a navigate issued while YTM is
      // still restoring its own watch state is swallowed, and the player then
      // sits cued forever with nothing to start it.
      await ctx.waitYtm(
        `(() => {
          const api = ${PLAYER_BAR}?.playerApi;
          if (!api?.getPlayerState) return null;
          if (api.getPlayerState() !== 1) api.playVideo?.();
          return api.getPlayerState();
        })()`,
        state => state === 1,
        120000
      );
      // YTM restores its own last watch state server-side and can win the race
      // against the navigate, so whatever ends up playing is the outgoing
      // track, not necessarily the one that was asked for.
      target = await ctx.evalYtm(`${PLAYER_BAR}.playerApi.getVideoData().video_id`);
      ctx.emit("probe", { playing: target });
      await ctx.evalYtm(`{ const v = document.querySelector("video"); v.muted = false; }`);
    },
    125000
  );

  await ctx.step(
    "queue offers a next track",
    async () => {
      const other = TRACK_IDS.find(id => id !== target);
      const aheadExpr = `(() => { const q = window.__YTMD_HOOK__?.ytmStore?.getState()?.queue; return q ? q.items.length - 1 - q.selectedItemIndex : -1; })()`;
      // A cold navigate reaches playing before the queue is populated, and the
      // clone below needs something to copy.
      await ctx.waitYtm(
        `(() => { const q = window.__YTMD_HOOK__?.ytmStore?.getState()?.queue; return q?.items?.length ?? 0; })()`,
        count => Number(count) > 0,
        30000
      );
      try {
        // Wait properly for YTM's own radio queue: a synthesized clone carries
        // a real videoId but YTM refuses to start it, which reads as a failed
        // mix when nothing is wrong with the engine.
        await ctx.waitYtm(aheadExpr, ahead => Number(ahead) > 0, 25000);
        return;
      } catch {
        // Still nothing; synthesize a second item from the current one.
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
    55000
  );

  await ctx.step("engine attached", () => ctx.waitYtm(`!!window.__ytmdDjCrossfade`, attached => attached === true, 15000), 20000);

  await ctx.step(
    "tail prepared inside the lead window",
    async () => {
      await ctx.evalYtm(`${PLAYER_BAR}.playerApi.seekTo(${TRACK_LENGTH} - 23)`);
      await ctx.waitYtm(`!!window.__ytmdDjCrossfade?.prep?.tail`, ready => ready === true, 45000);
    },
    50000
  );

  await ctx.step("sampler recording across the transition", async () => {
    // setInterval rather than timeupdate: if the incoming track is only cued
    // and never plays, timeupdate stops and the silence would go unrecorded.
    await ctx.evalYtm(`(() => {
      window.__mixSamples = [];
      clearInterval(window.__mixTimer);
      window.__mixTimer = setInterval(() => {
        const st = window.__ytmdDjCrossfade;
        const v = document.querySelector("video");
        if (!st || !v) return;
        if (window.__mixSamples.length > 600) return;
        window.__mixSamples.push({
          phase: st.phase,
          overlaps: st.overlapCount ?? 0,
          shadow: !!st.shadow,
          shadowGain: st.shadow ? st.shadow.gain.gain.value : null,
          outGain: window.__ytmdAudioGraph?.out?.gain?.value ?? null,
          videoId: ${PLAYER_BAR}?.playerApi?.getVideoData?.()?.video_id ?? null,
          playerState: ${PLAYER_BAR}?.playerApi?.getPlayerState?.() ?? null,
          currentTime: Math.round(v.currentTime * 100) / 100,
          trackPosition: Math.round(${TRACK_POSITION} * 100) / 100,
          trackLength: ${TRACK_LENGTH},
          ctxState: window.__ytmdAudioGraph?.context?.state ?? null,
          paused: v.paused,
          readyState: v.readyState
        });
      }, 200);
    })()`);
  });

  await ctx.step(
    "two tracks play at once",
    async () => {
      // No second seek: the track runs out on its own from the lead window
      // above. Jumping straight to the fade start skips YTM's prefetch of the
      // next track, and an incoming track still being fetched cannot sound
      // against a tail that is only five seconds long.
      // Let the whole fade window and the change that follows it elapse.
      await ctx.waitYtm(
        `JSON.stringify({ overlaps: window.__ytmdDjCrossfade?.overlapCount ?? 0, videoId: ${PLAYER_BAR}?.playerApi?.getVideoData?.()?.video_id ?? null })`,
        raw => {
          const status = JSON.parse(raw);
          return status.overlaps >= 1 && status.videoId && status.videoId !== target;
        },
        60000
      );
      await ctx.evalYtm(`new Promise(resolve => setTimeout(resolve, 3000))`);
      await ctx.evalYtm(`clearInterval(window.__mixTimer)`);

      const samples = JSON.parse(await ctx.evalYtm(`JSON.stringify(window.__mixSamples)`));
      // The definition of a mix: the outgoing tail still audible through the
      // shadow while the incoming track is genuinely running on the element.
      // readyState rather than currentTime: nextVideo rebuilds the media
      // source, so the incoming track reads position 0 for a moment while it
      // is genuinely decoding, and 0 again if it was only ever cued.
      const mixed = samples.filter(
        sample => sample.shadow && sample.shadowGain > 0 && sample.videoId && sample.videoId !== target && !sample.paused && sample.readyState >= 3
      );
      const overlapping = samples.filter(sample => sample.shadow && sample.shadowGain > 0);
      ctx.emit("probe", {
        samples: samples.length,
        lastFive: samples.slice(-5),
        overlapSamples: overlapping.length,
        mixedSamples: mixed.length,
        peakShadowGain: overlapping.reduce((peak, sample) => Math.max(peak, sample.shadowGain), 0),
        firstMixed: mixed[0] ?? null,
        aroundHandoff: samples.filter(sample => sample.phase === "overlap").slice(0, 8)
      });
      if (mixed.length === 0) {
        const reason = overlapping.length === 0 ? "the shadow never opened above gain 0" : "the incoming track never played while the tail was still sounding";
        throw new Error(`no sample had both tracks sounding: ${reason}`);
      }
    },
    95000
  );

  await ctx.step(
    "gain settles back at full",
    () => ctx.waitYtm(`window.__ytmdAudioGraph?.out?.gain?.value ?? null`, value => typeof value === "number" && value > 0.95, 25000),
    30000
  );
}
