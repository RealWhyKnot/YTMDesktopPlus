import { pageRecord, pageMember, pageArray, pageCall, optionalPageCall } from "./page-values";

export function runScript() {
  const hook: unknown = Reflect.get(window, "__YTMD_HOOK__");
  const bridge: unknown = Reflect.get(window, "ytmd");
  const ytmStore = pageMember(hook, "ytmStore");
  const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  if (!playerBar) return;
  const playerApi = pageMember(playerBar, "playerApi");

  function miss(what: string, error?: unknown) {
    const detail = String(error);
    optionalPageCall(bridge, "reportContractMiss", what, error ? detail : undefined);
  }

  function likeStatusFor(state: unknown, videoId: unknown) {
    const renderer = playerBar?.querySelector("ytmusic-like-button-renderer");
    if (!renderer) miss("ytmusic-like-button-renderer");
    const fallback = pageMember(renderer, "data", "likeStatus") ?? "UNKNOWN";
    const stored = typeof videoId === "string" ? pageMember(state, "likeStatus", "videos", videoId) : undefined;
    const hasStored = Boolean(stored);
    return hasStored ? stored : fallback;
  }

  let sentQueue: unknown;
  let sentPlayer: unknown[] | null = null;
  let isFlushPending = false;

  function sendStoreState() {
    isFlushPending = false;
    try {
      const state = pageRecord(pageCall(ytmStore, "getState"));
      if (!state) throw new Error("Player state is unavailable");
      if (state.queue !== sentQueue) {
        sentQueue = state.queue;
        pageCall(bridge, "sendQueueUpdate", pageCall(window, "__ytmdProjectQueue", state.queue));
      }
      const response = pageRecord(pageCall(playerApi, "getPlayerResponse"));
      const videoId = pageMember(response?.videoDetails, "videoId");
      const playerState = pageRecord(state.player);
      if (!playerState) throw new Error("Player state fields are unavailable");
      const player = [likeStatusFor(state, videoId), playerState.volume, playerState.muted, playerState.adPlaying];
      const previous = sentPlayer;
      if (previous === null || player.some((value, index) => value !== previous[index])) {
        sentPlayer = player;
        pageCall(bridge, "sendStoreUpdate", ...player);
      }
    } catch (error) {
      miss("store-state", error);
    }
  }

  function scheduleStoreState() {
    if (isFlushPending) return;
    isFlushPending = true;
    setTimeout(sendStoreState, 0);
  }

  pageCall(playerApi, "addEventListener", "onVideoProgress", (progress: unknown) => {
    pageCall(bridge, "sendVideoProgress", progress);
  });
  pageCall(playerApi, "addEventListener", "onStateChange", (state: unknown) => {
    pageCall(bridge, "sendVideoState", state);
  });
  pageCall(playerApi, "addEventListener", "onVideoDataChange", (event: unknown) => {
    const dataEvent = pageRecord(event);
    if (dataEvent?.playertype !== 1 || (dataEvent.type !== "dataloaded" && dataEvent.type !== "dataupdated")) return;

    try {
      const response = pageRecord(pageCall(playerApi, "getPlayerResponse"));
      const videoDetails = pageRecord(response?.videoDetails);
      if (!videoDetails) {
        if (response) miss("videoData: getPlayerResponse().videoDetails");
        return;
      }
      const playlistId = pageCall(playerApi, "getPlaylistId");
      let album: { id: unknown; text: unknown } | null = null;
      let hasFullMetadata = false;

      const currentItem = pageMember(playerBar, "currentItem");
      if (currentItem !== null && currentItem !== undefined) {
        hasFullMetadata = true;

        const titleRuns = pageMember(currentItem, "title", "runs");
        if (titleRuns)
          videoDetails.title = pageArray(titleRuns)
            .map((v) => pageMember(v, "text"))
            .join("");
        else miss("currentItem.title.runs");
        const thumbnail = pageMember(currentItem, "thumbnail");
        if (pageArray(pageMember(thumbnail, "thumbnails")).length > 0) videoDetails.thumbnail = thumbnail;

        const bylineRuns = pageMember(currentItem, "longBylineText", "runs");
        if (!bylineRuns) miss("currentItem.longBylineText.runs");
        for (const item of pageArray(bylineRuns)) {
          const browseEndpoint = pageMember(item, "navigationEndpoint", "browseEndpoint");
          const musicConfig = pageMember(browseEndpoint, "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig");
          if (pageMember(musicConfig, "pageType") === "MUSIC_PAGE_TYPE_ALBUM") {
            album = {
              id: pageMember(browseEndpoint, "browseId"),
              text: pageMember(item, "text"),
            };
          }
        }
      }

      const state = pageCall(ytmStore, "getState");
      pageCall(bridge, "sendVideoData", videoDetails, playlistId, album, likeStatusFor(state, videoDetails.videoId), hasFullMetadata);
    } catch (error) {
      miss("video-data", error);
    }
  });
  pageCall(ytmStore, "subscribe", scheduleStoreState);
  sendStoreState();
  window.addEventListener("yt-action", (e) => {
    try {
      const detail = pageRecord(pageMember(e, "detail"));
      if (!detail) throw new Error("Page action details are unavailable");
      if (detail.actionName === "yt-service-request") {
        const endpoint = pageRecord(pageMember(detail.args, 1));
        if (!endpoint) throw new Error("Page service request is unavailable");
        if (endpoint.createPlaylistServiceEndpoint) {
          const title = pageMember(detail.args, 2, "create_playlist_title");
          const returnValue = detail.returnValue;
          Promise.resolve(pageMember(returnValue, 0, "ajaxPromise"))
            .then((response) => {
              const id = pageMember(response, "data", "playlistId");
              pageCall(bridge, "sendCreatePlaylistObservation", {
                title,
                id,
              });
            })
            .catch((error: unknown) => miss("yt-action", error));
        }
      } else if (detail.actionName === "yt-handle-playlist-deletion-command") {
        const playlistId = pageMember(detail.args, 0, "handlePlaylistDeletionCommand", "playlistId");
        pageCall(bridge, "sendDeletePlaylistObservation", playlistId);
      }
    } catch (error) {
      miss("yt-action", error);
    }
  });
}
