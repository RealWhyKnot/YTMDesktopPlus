(function() {
  return new Promise((resolve, reject) => {
    var videoId = document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.getPlayerResponse()?.videoDetails?.videoId;
    if (!videoId) {
      reject(new Error("No video loaded"));
      return;
    }
    var returnValue = [];
    var serviceRequestEvent = {
      bubbles: true,
      cancelable: false,
      composed: true,
      detail: {
        actionName: "yt-service-request",
        args: [
          document.querySelector("ytmusic-app-layout>ytmusic-player-bar"),
          {
            addToPlaylistEndpoint: {
              videoId
            }
          }
        ],
        optionalAction: false,
        returnValue
      }
    };
    document.querySelector("ytmusic-app-layout>ytmusic-player-bar").dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
    returnValue[0].ajaxPromise.then(
      response => {
        resolve(response.data.contents[0].addToPlaylistRenderer.playlists);
      },
      () => {
        reject();
      }
    );
  });
})
