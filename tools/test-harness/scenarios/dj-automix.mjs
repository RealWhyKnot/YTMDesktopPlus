import { rmSync } from "node:fs";
import path from "node:path";
import { hooksReadyStep, playbackFixture } from "./lib.mjs";
// Answers one question the crossfade scenario cannot: are two tracks actually
// audible at the same time, and does auto DJ drive the change itself?
//
// dj-crossfade force-mutes the media element, which makes startOverlap open the
// shadow at gain 0 - the code path runs but nothing overlaps. Here the element
// stays unmuted and silence comes from YTMD_TEST_MUTED, which mutes the
// webContents output while leaving the Web Audio graph running, so the shadow
// gain is a real measured level. autoDj is on, so the jump goes through
// playQueueIndex rather than nextVideo.
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
      await ctx.waitYtm(`${PLAYER_BAR}?.playerApi?.getPlayerState?.() ?? null`, state => state === 1, 120000);
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
        await ctx.waitYtm(aheadExpr, ahead => Number(ahead) > 0, 8000);
        return;
      } catch {
        // No radio queue; synthesize a second item from the current one.
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
    "auto DJ chose the next track itself",
    async () => {
      // A non-null transitionIndex is auto DJ's pick reaching the page: the
      // jump will go through playQueueIndex instead of a blind nextVideo.
      await ctx.waitYtm(`window.__ytmdDjCrossfade?.config?.transitionIndex ?? null`, index => Number.isInteger(index), 20000);
      const index = await ctx.evalYtm(`window.__ytmdDjCrossfade.config.transitionIndex`);
      ctx.emit("probe", { transitionIndex: index });
    },
    25000
  );

  await ctx.step(
    "tail prepared inside the lead window",
    async () => {
      await ctx.evalYtm(`${PLAYER_BAR}.playerApi.seekTo(document.querySelector("video").duration - 23)`);
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
          paused: v.paused,
          readyState: v.readyState
        });
      }, 200);
    })()`);
  });

  await ctx.step(
    "two tracks play at once",
    async () => {
      await ctx.evalYtm(`${PLAYER_BAR}.playerApi.seekTo(document.querySelector("video").duration - 5)`);
      // Let the whole fade window and the change that follows it elapse.
      await ctx.waitYtm(
        `JSON.stringify({ overlaps: window.__ytmdDjCrossfade?.overlapCount ?? 0, videoId: ${PLAYER_BAR}?.playerApi?.getVideoData?.()?.video_id ?? null })`,
        raw => {
          const status = JSON.parse(raw);
          return status.overlaps >= 1 && status.videoId && status.videoId !== target;
        },
        45000
      );
      await ctx.evalYtm(`new Promise(resolve => setTimeout(resolve, 3000))`);
      await ctx.evalYtm(`clearInterval(window.__mixTimer)`);

      const samples = JSON.parse(await ctx.evalYtm(`JSON.stringify(window.__mixSamples)`));
      // The definition of a mix: the outgoing tail still audible through the
      // shadow while the incoming track is genuinely running on the element.
      const mixed = samples.filter(
        sample => sample.shadow && sample.shadowGain > 0 && sample.videoId && sample.videoId !== target && !sample.paused && sample.currentTime > 0
      );
      const overlapping = samples.filter(sample => sample.shadow && sample.shadowGain > 0);
      ctx.emit("probe", {
        samples: samples.length,
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
    75000
  );

  await ctx.step(
    "gain settles back at full",
    () => ctx.waitYtm(`window.__ytmdAudioGraph?.out?.gain?.value ?? null`, value => typeof value === "number" && value > 0.95, 25000),
    30000
  );
}
