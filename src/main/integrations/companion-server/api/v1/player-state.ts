import type { PlayerState } from "../../../../player-state-store";

export const transformPlayerState = (state: PlayerState) => {
  return {
    player: {
      trackState: state.trackState,
      videoProgress: state.videoProgress,
      volume: state.volume,
      muted: state.muted,
      adPlaying: state.adPlaying,
      queue: state.queue
        ? {
            autoplay: state.queue.autoplay,
            items: state.queue.items,
            automixItems: state.queue.automixItems,
            isGenerating: state.queue.isGenerating,
            isInfinite: state.queue.isInfinite,
            repeatMode: state.queue.repeatMode,
            selectedItemIndex: state.queue.selectedItemIndex,
          }
        : null,
    },
    video: state.videoDetails
      ? {
          author: state.videoDetails.author,
          channelId: state.videoDetails.channelId,
          title: state.videoDetails.title,
          album: state.videoDetails.album,
          albumId: state.videoDetails.albumId,
          likeStatus: state.videoDetails.likeStatus,
          thumbnails: state.videoDetails.thumbnails,
          durationSeconds: state.videoDetails.durationSeconds,
          id: state.videoDetails.id,
          isLive: state.videoDetails.isLive,
          videoType: state.videoDetails.videoType,

          metadataFilled: state.hasFullMetadata,
        }
      : null,

    playlistId: state.playlistId,
  };
};
