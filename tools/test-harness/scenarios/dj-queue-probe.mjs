import { hooksReadyStep, playbackFixture } from "./lib.mjs";
// Confirms the queue accepts direct store writes: ADD_ITEMS inserts a
// playlistPanelVideoRenderer at an index and REMOVE_ITEM takes it back out.
// The dj addon enqueues its picks through these two actions. The probe
// clones an existing item and removes it again, so the queue ends unchanged.
// Local diagnostic, reaches live YouTube Music.

export const fixture = {
  playback: playbackFixture()
};

const VIDEO_ID = "dQw4w9WgXcQ";

export default async function djQueueProbe(ctx) {
  await hooksReadyStep(ctx);

  await ctx.step(
    "a track is playing",
    async () => {
      await ctx.evalYtm(`document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: "${VIDEO_ID}" } } } }))`);
      await ctx.waitYtm(`document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerState?.() ?? null`, state => state === 1, 120000);
      await ctx.evalYtm(`document.querySelector("video").muted = true`);
    },
    125000
  );

  await ctx.step(
    "queue populated",
    () => ctx.waitYtm(`window.__YTMD_HOOK__?.ytmStore?.getState()?.queue?.items?.length ?? 0`, count => Number(count) > 0, 30000),
    35000
  );

  await ctx.step(
    "ADD_ITEMS inserts and REMOVE_ITEM restores",
    async () => {
      const result = JSON.parse(
        await ctx.evalYtm(
          `(async () => {
            const store = window.__YTMD_HOOK__.ytmStore;
            const count = () => store.getState().queue.items.length;
            const before = count();
            const clone = JSON.parse(JSON.stringify(store.getState().queue.items[0]));
            store.dispatch({
              type: "ADD_ITEMS",
              payload: {
                nextQueueItemId: store.getState().queue.nextQueueItemId,
                index: before,
                items: [clone],
                shuffleEnabled: false,
                shouldAssignIds: true
              }
            });
            await new Promise(resolve => setTimeout(resolve, 300));
            const added = count();
            store.dispatch({ type: "REMOVE_ITEM", payload: added - 1 });
            await new Promise(resolve => setTimeout(resolve, 300));
            return JSON.stringify({ before, added, restored: count() });
          })()`
        )
      );
      ctx.emit("probe", result);
      if (result.added !== result.before + 1) throw new Error(`ADD_ITEMS had no effect: ${JSON.stringify(result)}`);
      if (result.restored !== result.before) throw new Error(`REMOVE_ITEM left the queue at ${result.restored}, expected ${result.before}`);
    },
    20000
  );
}
