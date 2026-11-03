export function runScript() {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  function isPlayerApi(value: unknown): value is { getPlayerResponse(): unknown } {
    return isRecord(value) && typeof value.getPlayerResponse === "function";
  }
  function at(value: unknown, ...keys: (string | number)[]): unknown {
    for (const key of keys) value = isRecord(value) ? value[key] : undefined;
    return value;
  }
  return new Promise<unknown>((resolve, reject) => {
    const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    const api = playerBar && "playerApi" in playerBar ? playerBar.playerApi : undefined;
    const rawResponse = isPlayerApi(api) ? api.getPlayerResponse() : undefined;
    const response = isRecord(rawResponse) ? rawResponse : undefined;
    const videoDetails = response?.videoDetails;
    const videoId = isRecord(videoDetails) ? videoDetails.videoId : undefined;
    if (!videoId) {
      reject(new Error("No video loaded"));
      return;
    }
    const returnValue: unknown[] = [];
    const serviceRequestEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [
          document.querySelector("ytmusic-app-layout>ytmusic-player-bar"),
          {
            addToPlaylistEndpoint: {
              videoId,
            },
          },
        ],
        optionalAction: false,
        returnValue,
      },
    };
    playerBar?.dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
    Promise.resolve(at(returnValue[0], "ajaxPromise"))
      .then(
        (response) => {
          resolve(at(response, "data", "contents", 0, "addToPlaylistRenderer", "playlists"));
        },
        (reason: unknown) => {
          reject(new Error("Could not load playlists", reason === undefined ? undefined : { cause: reason }));
        }
      )
      .catch(reject);
  });
}
