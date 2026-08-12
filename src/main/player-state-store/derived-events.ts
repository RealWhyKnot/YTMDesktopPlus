import { VideoState, type PlayerEventMap, type PlayerEventName, type PlayerQueue, type PlayerState } from "~shared/addons/sdk";

// Progress reports arrive about once a second; anything past this within one
// track is a jump, not natural playback.
export const SEEK_JUMP_SECONDS = 1.5;

function queueSignature(queue: PlayerQueue | null): string {
  if (!queue) return "";
  return [queue.items.map(item => item.videoId).join(","), queue.automixItems.length, queue.selectedItemIndex, queue.repeatMode].join("|");
}

/** Feed full snapshots in; granular events come out. The first snapshot seeds
 *  the baseline and emits nothing. One instance serves the whole app. */
export function createPlayerEventDeriver(emit: <K extends PlayerEventName>(event: K, payload: PlayerEventMap[K]) => void): {
  next(state: PlayerState): void;
} {
  let previous: PlayerState | null = null;

  return {
    next(state) {
      const prev = previous;
      previous = state;
      if (!prev) return;

      const previousId = prev.videoDetails?.id ?? null;
      const currentId = state.videoDetails?.id ?? null;
      const trackSwitched = previousId !== currentId;

      if (trackSwitched) {
        emit("trackChanged", { current: state.videoDetails, previous: prev.videoDetails, playlistId: state.playlistId });
      }
      if (prev.trackState !== state.trackState) {
        emit("playStateChanged", { playing: state.trackState === VideoState.Playing, trackState: state.trackState });
      }
      if (prev.volume !== state.volume || prev.muted !== state.muted) {
        emit("volumeChanged", { volume: state.volume, muted: state.muted });
      }
      if (!trackSwitched) {
        const delta = state.videoProgress - prev.videoProgress;
        if (delta < 0 || delta > SEEK_JUMP_SECONDS) {
          emit("seeked", { fromSeconds: prev.videoProgress, toSeconds: state.videoProgress });
        }
      }
      if (prev.adPlaying !== state.adPlaying) {
        emit("adStateChanged", { adPlaying: state.adPlaying });
      }
      if (queueSignature(prev.queue) !== queueSignature(state.queue)) {
        emit("queueChanged", { queue: state.queue });
      }
      const previousLike = prev.videoDetails?.likeStatus;
      const currentLike = state.videoDetails?.likeStatus;
      if (!trackSwitched && previousLike !== undefined && currentLike !== undefined && previousLike !== currentLike) {
        emit("likeChanged", { likeStatus: currentLike, videoId: currentId });
      }
      const previousRepeat = prev.queue?.repeatMode;
      const currentRepeat = state.queue?.repeatMode;
      if (previousRepeat !== undefined && currentRepeat !== undefined && previousRepeat !== currentRepeat) {
        emit("repeatModeChanged", { repeatMode: currentRepeat });
      }
    }
  };
}
