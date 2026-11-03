import { executePageScript } from "./execute-page-script";
import { readIntegerPrefix } from "~shared/integer-prefix";
import { PLAYER_BAR_SELECTOR } from "~shared/hook-probes";
import { steppedVolume, VOLUME_STEP } from "./volume-step";
import toggleRatingScript from "./scripts/togglerating.script?raw";

const toggleLikeScript = toggleRatingScript.replaceAll("__RATING__", "LIKE").replaceAll("__OPPOSITE__", "DISLIKE");
const toggleDislikeScript = toggleRatingScript.replaceAll("__RATING__", "DISLIKE").replaceAll("__OPPOSITE__", "LIKE");

export async function executeRemoteCommand(command: unknown, value: unknown): Promise<void> {
  switch (command) {
    case "playPause": {
      (
        await executePageScript(`
          (function() {
            const playerBar = document.querySelector("${PLAYER_BAR_SELECTOR}");
            if (playerBar.playing) {
              window.__ytmdPause(playerBar.playerApi);
            } else {
              playerBar.playerApi.playVideo();
            }
          })
        `)
      )();
      break;
    }

    case "play": {
      (
        await executePageScript(`
          (function() {
            document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.playVideo();
          })
        `)
      )();
      break;
    }

    case "pause": {
      (
        await executePageScript(`
          (function() {
            window.__ytmdPause(document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi);
          })
        `)
      )();
      break;
    }

    case "next": {
      (
        await executePageScript(`
          (function() {
            const playerBar = document.querySelector("${PLAYER_BAR_SELECTOR}");
            const nextButton = playerBar.querySelector(".next-button");
            if (nextButton) {
              nextButton.click();
            } else {
              window.ytmd.reportContractMiss("${PLAYER_BAR_SELECTOR} .next-button");
              playerBar.playerApi.nextVideo();
            }
          })
        `)
      )();
      break;
    }

    case "previous": {
      (
        await executePageScript(`
          (function() {
            document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.previousVideo();
          })
        `)
      )();
      break;
    }

    case "toggleLike": {
      (await executePageScript(toggleLikeScript))();
      break;
    }

    case "toggleDislike": {
      (await executePageScript(toggleDislikeScript))();
      break;
    }

    case "volumeUp": {
      const currentVolumeUp = (
        await executePageScript(`
          (function() {
            return document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.getVolume();
          })
        `)
      )();

      if (typeof currentVolumeUp !== "number") break;
      const newVolumeUp = steppedVolume(currentVolumeUp, VOLUME_STEP);
      if (newVolumeUp === null) break;
      (
        await executePageScript(`
          (function(newVolumeUp) {
            document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.setVolume(newVolumeUp);
            window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: newVolumeUp });
          })
        `)
      )(newVolumeUp);
      break;
    }

    case "volumeDown": {
      const currentVolumeDown = (
        await executePageScript(`
          (function() {
            return document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.getVolume();
          })
        `)
      )();

      if (typeof currentVolumeDown !== "number") break;
      const newVolumeDown = steppedVolume(currentVolumeDown, -VOLUME_STEP);
      if (newVolumeDown === null) break;
      (
        await executePageScript(`
          (function(newVolumeDown) {
            document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.setVolume(newVolumeDown);
            window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: newVolumeDown });
          })
        `)
      )(newVolumeDown);
      break;
    }

    case "setVolume": {
      const valueInt = readIntegerPrefix(String(value));

      if (!Number.isFinite(valueInt) || valueInt < 0 || valueInt > 100) {
        return;
      }

      (
        await executePageScript(`
          (function(valueInt) {
            document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.setVolume(valueInt);
            window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: valueInt });
          })
        `)
      )(valueInt);
      break;
    }

    case "mute":
      (
        await executePageScript(`
          (function() {
            document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.mute();
            window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_MUTED', payload: true });
          })
        `)
      )();
      break;

    case "unmute":
      (
        await executePageScript(`
          (function() {
            document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.unMute();
            window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_MUTED', payload: false });
          })
        `)
      )();
      break;

    case "repeatMode":
      (
        await executePageScript(`
          (function(value) {
            window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_REPEAT', payload: value });
          })
        `)
      )(value);
      break;

    case "seekTo":
      (
        await executePageScript(`
          (function(value) {
            document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.seekTo(value);
          })
        `)
      )(value);
      break;

    case "shuffle":
      (
        await executePageScript(`
          (function() {
            document.querySelector("${PLAYER_BAR_SELECTOR}").queue.shuffle();
          })
        `)
      )();
      break;

    case "playQueueIndex": {
      const index = readIntegerPrefix(String(value));
      if (!Number.isFinite(index)) return;

      (
        await executePageScript(`
          (function(index) {
            const state = window.__YTMD_HOOK__.ytmStore.getState();
            const queue = state.queue;

            const maxQueueIndex = state.queue.items.length - 1;
            const maxAutoMixQueueIndex = Math.max(state.queue.automixItems.length - 1, 0);

            let useAutoMix = false;
            if (index > maxQueueIndex) {
              index = index - state.queue.items.length;
              useAutoMix = true;
            }

            let song = null;
            if (!useAutoMix) {
              song = queue.items[index];
            } else {
              song = queue.automixItems[index];
            }

            let playlistPanelVideoRenderer;
            if (song.playlistPanelVideoRenderer) {
              playlistPanelVideoRenderer = song.playlistPanelVideoRenderer;
            } else if (song.playlistPanelVideoWrapperRenderer) {
              playlistPanelVideoRenderer = song.playlistPanelVideoWrapperRenderer.primaryRenderer.playlistPanelVideoRenderer;
            }

            document.dispatchEvent(
              new CustomEvent("yt-navigate", {
                detail: {
                  endpoint: {
                    watchEndpoint: playlistPanelVideoRenderer.navigationEndpoint.watchEndpoint
                  }
                }
              })
            );
          })
        `)
      )(index);

      break;
    }

    case "navigate": {
      const endpoint = value;
      document.dispatchEvent(
        new CustomEvent("yt-navigate", {
          detail: {
            endpoint,
          },
        })
      );
      break;
    }
  }
}
