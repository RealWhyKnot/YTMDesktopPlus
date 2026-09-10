(function() {
  const ytmStore = window.__YTMD_HOOK__.ytmStore;
  const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const playerApi = playerBar.playerApi;

  function miss(what, error) {
    window.ytmd?.reportContractMiss?.(what, error ? String(error) : undefined);
  }

  function likeStatusFor(state, videoId) {
    const renderer = playerBar.querySelector("ytmusic-like-button-renderer");
    if (!renderer) miss("ytmusic-like-button-renderer");
    const fallback = renderer?.data?.likeStatus ?? "UNKNOWN";
    const stored = state.likeStatus?.videos?.[videoId];
    return stored ? stored : fallback;
  }

  function sendStoreState() {
    try {
      // We don't want to see everything in the store as there can be some sensitive data so we only send what's necessary to operate
      const state = ytmStore.getState();
      const videoId = playerApi.getPlayerResponse()?.videoDetails?.videoId;
      window.ytmd.sendStoreUpdate(state.queue, likeStatusFor(state, videoId), state.player.volume, state.player.muted, state.player.adPlaying);
    } catch (error) {
      miss("store-state", error);
    }
  }

  playerApi.addEventListener("onVideoProgress", progress => {
    window.ytmd.sendVideoProgress(progress);
  });
  playerApi.addEventListener("onStateChange", state => {
    window.ytmd.sendVideoState(state);
  });
  playerApi.addEventListener("onVideoDataChange", event => {
    if (event.playertype !== 1 || (event.type !== "dataloaded" && event.type !== "dataupdated")) return;

    try {
      const response = playerApi.getPlayerResponse();
      const videoDetails = response?.videoDetails;
      if (!videoDetails) {
        if (response) miss("videoData: getPlayerResponse().videoDetails");
        return;
      }
      const playlistId = playerApi.getPlaylistId();
      let album = null;
      let hasFullMetadata = false;

      // If playing from online sources this usually is filled out with the first dataupdated which is followed after dataloaded. While offline this is always filled
      const currentItem = playerBar.currentItem;
      if (currentItem !== null && currentItem !== undefined) {
        hasFullMetadata = true;

        // Fill out video details with better information
        const titleRuns = currentItem.title?.runs;
        if (titleRuns) videoDetails.title = titleRuns.map(v => v.text).join(""); // Can contain featuring text which isn't in player response
        else miss("currentItem.title.runs");
        videoDetails.thumbnail = currentItem.thumbnail; // Can contain more thumbnails than player response

        const bylineRuns = currentItem.longBylineText?.runs;
        if (!bylineRuns) miss("currentItem.longBylineText.runs");
        for (let i = 0; i < (bylineRuns?.length ?? 0); i++) {
          const item = bylineRuns[i];
          const browseEndpoint = item.navigationEndpoint?.browseEndpoint;
          const musicConfig = browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig;
          if (musicConfig?.pageType === "MUSIC_PAGE_TYPE_ALBUM") {
            album = {
              id: browseEndpoint.browseId,
              text: item.text
            };
          }
        }
      }

      const state = ytmStore.getState();
      window.ytmd.sendVideoData(videoDetails, playlistId, album, likeStatusFor(state, videoDetails.videoId), hasFullMetadata);
    } catch (error) {
      miss("video-data", error);
    }
  });
  ytmStore.subscribe(() => {
    sendStoreState();
  });
  window.addEventListener("yt-action", e => {
    try {
      if (e.detail.actionName === "yt-service-request") {
        if (e.detail.args[1].createPlaylistServiceEndpoint) {
          let title = e.detail.args[2].create_playlist_title;
          let returnValue = e.detail.returnValue;
          returnValue[0].ajaxPromise.then(response => {
            let id = response.data.playlistId;
            window.ytmd.sendCreatePlaylistObservation({
              title,
              id
            });
          });
        }
      } else if (e.detail.actionName === "yt-handle-playlist-deletion-command") {
        let playlistId = e.detail.args[0].handlePlaylistDeletionCommand.playlistId;
        window.ytmd.sendDeletePlaylistObservation(playlistId);
      }
    } catch (error) {
      miss("yt-action", error);
    }
  });
})
