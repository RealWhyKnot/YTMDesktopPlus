import { installSleepTimer } from "./sleep-timer";
import { pageMember, pageRecord, pageArray, pageCall, optionalPageCall } from "./page-values";

export function runScript() {
  const hook: unknown = Reflect.get(window, "__YTMD_HOOK__");
  const bridge: unknown = Reflect.get(window, "ytmd");
  const ytmStore = pageMember(hook, "ytmStore");

  function miss(what: string, detail?: unknown) {
    optionalPageCall(bridge, "reportContractMiss", what, detail);
  }

  const playerBar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  if (!playerBar) return;

  let currentVideoId = "";

  let libraryFeedbackDefaultToken = "";
  let libraryFeedbackToggledToken = "";

  const libraryButton: HTMLElement & { rawProps?: unknown } = document.createElement("yt-button-shape");
  libraryButton.classList.add("ytmd-player-bar-control");
  libraryButton.classList.add("library-button");
  const libraryButtonData = {
    focused: false,
    iconPosition: "icon-only",
    onTap: function (this: HTMLElement) {
      const closePopupEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-close-popups-action",
          args: [["ytmusic-menu-popup-renderer"]],
          optionalAction: false,
          returnValue: [],
        },
      };
      const feedbackEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-service-request",
          args: [
            this,
            {
              feedbackEndpoint: {
                feedbackToken: libraryButtonData.toggled ? libraryFeedbackToggledToken : libraryFeedbackDefaultToken,
              },
            },
          ],
          optionalAction: false,
          returnValue: [],
        },
      };
      this.dispatchEvent(new CustomEvent("yt-action", closePopupEvent));
      this.dispatchEvent(new CustomEvent("yt-action", feedbackEvent));
      pageCall(ytmStore, "dispatch", {
        type: "SET_FEEDBACK_TOGGLE_STATE",
        payload: { defaultEndpointFeedbackToken: libraryFeedbackDefaultToken, isToggled: !libraryButtonData.toggled },
      });
    }.bind(libraryButton),
    style: "mono",
    toggled: false,
    toggleable: true,
    type: "text",
  };
  libraryButton.rawProps = {
    iconName: "yt-sys-icons:library_add",
    data: libraryButtonData,
  };
  const likeButtonRenderer = playerBar.querySelector("ytmusic-like-button-renderer");
  if (likeButtonRenderer) likeButtonRenderer.insertAdjacentElement("afterend", libraryButton);
  else miss("ytmusic-like-button-renderer");

  const playlistButton: HTMLElement & { rawProps?: unknown } = document.createElement("yt-button-shape");
  playlistButton.classList.add("ytmd-player-bar-control");
  playlistButton.classList.add("playlist-button");
  const playlistButtonData = {
    focused: false,
    iconPosition: "icon-only",
    onTap: function (this: HTMLElement) {
      const closePopupEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-close-popups-action",
          args: [["ytmusic-menu-popup-renderer"]],
          optionalAction: false,
          returnValue: [],
        },
      };
      const returnValue: unknown[] = [];
      const serviceRequestEvent = {
        bubbles: true,
        cancelable: false,
        composed: true,
        detail: {
          actionName: "yt-service-request",
          args: [
            this,
            {
              addToPlaylistEndpoint: {
                videoId: currentVideoId,
              },
            },
          ],
          optionalAction: false,
          returnValue,
        },
      };
      this.dispatchEvent(new CustomEvent("yt-action", closePopupEvent));
      this.dispatchEvent(new CustomEvent("yt-action", serviceRequestEvent));
      Promise.resolve(pageMember(returnValue, 0, "ajaxPromise"))
        .then(
          (response) => {
            const addToPlaylistEvent = {
              bubbles: true,
              cancelable: false,
              composed: true,
              detail: {
                actionName: "yt-open-popup-action",
                args: [
                  {
                    openPopupAction: {
                      popup: {
                        addToPlaylistRenderer: pageMember(response, "data", "contents", 0, "addToPlaylistRenderer"),
                      },
                      popupType: "DIALOG",
                    },
                  },
                  this,
                ],
                optionalAction: false,
                returnValue: [],
              },
            };
            this.dispatchEvent(new CustomEvent("yt-action", addToPlaylistEvent));
            this.dispatchEvent(new CustomEvent("yt-action", closePopupEvent));
          },
          () => {
            return undefined;
          }
        )
        .catch((error: unknown) => miss("playerBarControls: playlist request", error));
    }.bind(playlistButton),
    style: "mono",
    toggled: false,
    type: "text",
  };
  playlistButton.rawProps = {
    iconName: "yt-sys-icons:playlist_add",
    data: playlistButtonData,
  };
  libraryButton.insertAdjacentElement("afterend", playlistButton);

  const playerApi = pageMember(playerBar, "playerApi");
  pageCall(playerApi, "addEventListener", "onVideoDataChange", (event: unknown) => {
    const dataEvent = pageRecord(event);
    if (dataEvent?.playertype === 1 && (dataEvent.type === "dataloaded" || dataEvent.type === "dataupdated")) {
      const response = pageRecord(pageCall(playerApi, "getPlayerResponse"));
      const videoId = pageMember(response?.videoDetails, "videoId");
      if (typeof videoId === "string" && videoId) currentVideoId = videoId;
      else if (response) miss("playerBarControls: getPlayerResponse().videoDetails");
    }
  });

  installSleepTimer(playerBar, miss);

  let seenQueue: unknown;
  let seenToggleStates: unknown;

  pageCall(ytmStore, "subscribe", () => {
    try {
      const state = pageRecord(pageCall(ytmStore, "getState"));
      if (state?.queue === seenQueue && state?.toggleStates === seenToggleStates) return;
      seenQueue = state?.queue;
      seenToggleStates = state?.toggleStates;

      const currentMenu = optionalPageCall(playerBar, "getMenuRenderer");
      if (currentMenu) {
        if (playlistButton.hasAttribute("hidden")) {
          playlistButton.removeAttribute("hidden");
        }

        let isFoundLibraryButton = false;
        const menuItems = pageArray(pageMember(currentMenu, "items"));
        for (const item of menuItems) {
          const toggleRenderer = pageMember(item, "toggleMenuServiceItemRenderer");
          if (toggleRenderer) {
            const iconType = pageMember(toggleRenderer, "defaultIcon", "iconType");
            if (iconType === "BOOKMARK_BORDER" || iconType === "BOOKMARK") {
              isFoundLibraryButton = true;
              const defaultToken = pageMember(toggleRenderer, "defaultServiceEndpoint", "feedbackEndpoint", "feedbackToken");
              const toggledToken = pageMember(toggleRenderer, "toggledServiceEndpoint", "feedbackEndpoint", "feedbackToken");
              libraryFeedbackDefaultToken = typeof defaultToken === "string" ? defaultToken : "";
              libraryFeedbackToggledToken = typeof toggledToken === "string" ? toggledToken : "";

              const toggled = pageMember(state, "toggleStates", "feedbackToggleStates", libraryFeedbackDefaultToken);
              if (typeof toggled === "boolean") {
                libraryButtonData.toggled = toggled;
                pageCall(pageMember(libraryButton, "setters"), "data", libraryButtonData);
              } else {
                libraryButtonData.toggled = false;
                pageCall(pageMember(libraryButton, "setters"), "data", libraryButtonData);
              }

              if (iconType === "BOOKMARK_BORDER") {
                if (libraryButtonData.toggled) {
                  pageCall(pageMember(libraryButton, "setters"), "iconName", "yt-sys-icons:library_saved");
                } else {
                  pageCall(pageMember(libraryButton, "setters"), "iconName", "yt-sys-icons:library_add");
                }
              } else {
                if (libraryButtonData.toggled) {
                  pageCall(pageMember(libraryButton, "setters"), "iconName", "yt-sys-icons:library_add");
                } else {
                  pageCall(pageMember(libraryButton, "setters"), "iconName", "yt-sys-icons:library_saved");
                }
              }
              break;
            }
          }
        }

        if (!isFoundLibraryButton) {
          if (!libraryButton.hasAttribute("hidden")) {
            libraryButton.setAttribute("hidden", "");
          }
        } else {
          if (libraryButton.hasAttribute("hidden")) {
            libraryButton.removeAttribute("hidden");
          }
        }
      } else {
        if (!libraryButton.hasAttribute("hidden")) {
          libraryButton.setAttribute("hidden", "");
        }
        if (!playlistButton.hasAttribute("hidden")) {
          playlistButton.setAttribute("hidden", "");
        }
      }
    } catch (error) {
      miss("playerBarControls: store subscriber", String(error));
    }
  });
}
