export function runScript() {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  function at(value: unknown, ...keys: string[]): unknown {
    for (const key of keys) value = isRecord(value) ? value[key] : undefined;
    return value;
  }
  function isPlayerApi(value: unknown): value is { getPlayerResponse(): unknown } {
    return isRecord(value) && typeof value.getPlayerResponse === "function";
  }
  function isStore(value: unknown): value is { getState(): unknown } {
    return isRecord(value) && typeof value.getState === "function";
  }
  const hook: unknown = Reflect.get(window, "__YTMD_HOOK__");
  const ytmStore = at(hook, "ytmStore");
  if (!isStore(ytmStore)) return;

  const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const api = playerBar && "playerApi" in playerBar ? playerBar.playerApi : undefined;
  const rawResponse = isPlayerApi(api) ? api.getPlayerResponse() : undefined;
  const response = isRecord(rawResponse) ? rawResponse : undefined;
  const videoId = at(response?.videoDetails, "videoId");
  if (typeof videoId !== "string" || !videoId) return;
  const likeButton = playerBar?.querySelector("ytmusic-like-button-renderer");
  const likeButtonData = likeButton && "data" in likeButton ? likeButton.data : undefined;
  if (!isRecord(likeButtonData) || !Array.isArray(likeButtonData.serviceEndpoints)) return;

  let targetServiceEndpoint: unknown = null;
  let indifferentServiceEndpoint: unknown = null;

  const endpoints: unknown[] = likeButtonData.serviceEndpoints;
  for (const endpoint of endpoints) {
    if (at(endpoint, "likeEndpoint", "status") === "__RATING__") {
      targetServiceEndpoint = endpoint;
    } else if (at(endpoint, "likeEndpoint", "status") === "INDIFFERENT") {
      indifferentServiceEndpoint = endpoint;
    }
  }

  let serviceEvent: CustomEventInit<unknown> | null = null;

  const defaultLikeStatus = likeButtonData.likeStatus;
  const state = ytmStore.getState();
  const storeLikeStatus = at(state, "likeStatus", "videos", videoId);

  const hasStoreLikeStatus = Boolean(storeLikeStatus);
  const likeStatus = hasStoreLikeStatus ? storeLikeStatus : defaultLikeStatus;

  if (likeStatus === "__RATING__") {
    serviceEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [document.querySelector("ytmusic-like-button-renderer"), indifferentServiceEndpoint],
        optionalAction: false,
        returnValue: [],
      },
    };
  } else if (likeStatus === "__OPPOSITE__" || likeStatus === "INDIFFERENT") {
    serviceEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [document.querySelector("ytmusic-like-button-renderer"), targetServiceEndpoint],
        optionalAction: false,
        returnValue: [],
      },
    };
  }

  if (serviceEvent) document.querySelector("ytmusic-like-button-renderer")?.dispatchEvent(new CustomEvent("yt-action", serviceEvent));
}
