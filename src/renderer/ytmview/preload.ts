// IMPORTANT NOTES ABOUT THIS FILE
//
// This file contains all logic related to interacting with YTM itself and works under the assumption of a trusted environment and data.
// Anything passed to this file does not necessarily need to be or will be validated.
//
// If adding new things to this file ensure best security practices are followed.
// - executeJavaScript is used to enter the main world when you need to interact with YTM APIs or anything from YTM that would otherwise need the prototypes or events from YTM.
//   - Always wrap your executeJavaScript code in an IIFE calling it from outside executeJavaScript when it returns
// - Add functions to exposeInMainWorld when you need to call back to the main program. By nature you should not trust data coming from this.

import { contextBridge, ipcRenderer, webFrame } from "electron";
import Store from "../store-ipc/store";
import { StoreSchema } from "~shared/store/schema";
import {
  HOOK_POLL_INTERVAL,
  HOOK_POLL_MAX_ATTEMPTS,
  PLAYER_BAR_SELECTOR,
  PlayerBarProbeSnapshot,
  playerBarProbeSource,
  pollUntil,
  storeHookProbeSource
} from "~shared/hook-probes";
import { mergeScript, type ScriptTable } from "./script-table";

import playerBarControlsScript from "./scripts/playerbarcontrols.script?raw";
import hookPlayerApiEventsScript from "./scripts/hookplayerapievents.script?raw";
import getPlaylistsScript from "./scripts/getplaylists.script?raw";
import toggleRatingScript from "./scripts/togglerating.script?raw";
import devProbeScript from "./scripts/devprobe.script?raw";

const toggleLikeScript = toggleRatingScript.replaceAll("__RATING__", "LIKE").replaceAll("__OPPOSITE__", "DISLIKE");
const toggleDislikeScript = toggleRatingScript.replaceAll("__RATING__", "DISLIKE").replaceAll("__OPPOSITE__", "LIKE");

// Compiled to a literal by Vite: true in development and local sideload builds,
// false (so the branches below are dropped) in published beta and release
// builds.
declare const YTMD_DEV_TOOLS: boolean;

const store = new Store<StoreSchema>();

// Test seam: force a hook stage to fail so the failure path can be exercised
// deterministically. Asked from the main process per view creation because
// renderer processes (and their argv) can be reused across view recreations.
const brokenHookStage: string | null = process.argv.includes("--ytmd-test") ? ipcRenderer.sendSync("ytmdTest:getBrokenHookStage") : null;
const failingBooleanProbeSource = `(function() { return false; })`;
const failingPlayerBarProbeSource = `(function() { return { playerBarPresent: false, playerApiPresent: false, playerApiReady: false }; })`;

contextBridge.exposeInMainWorld("ytmd", {
  sendVideoProgress: (volume: number) => ipcRenderer.send("ytmView:videoProgressChanged", volume),
  sendVideoState: (state: number) => ipcRenderer.send("ytmView:videoStateChanged", state),
  sendVideoData: (videoDetails: unknown, playlistId: string, album: { id: string; text: string }, likeStatus: unknown, hasFullMetadata: boolean) =>
    ipcRenderer.send("ytmView:videoDataChanged", videoDetails, playlistId, album, likeStatus, hasFullMetadata),
  sendStoreUpdate: (queueState: unknown, likeStatus: string, volume: number, muted: boolean, adPlaying: boolean) =>
    ipcRenderer.send("ytmView:storeStateChanged", queueState, likeStatus, volume, muted, adPlaying),
  sendCreatePlaylistObservation: (playlist: unknown) => ipcRenderer.send("ytmView:createPlaylistObserved", playlist),
  sendDeletePlaylistObservation: (playlistId: string) => ipcRenderer.send("ytmView:deletePlaylistObserved", playlistId),
  // Page scripts push to their addon's main-process half; delivery lands on
  // the addon's ctx.ytmview.onMessage(name) callbacks.
  postAddonMessage: (addonId: string, name: string, payload?: unknown) => ipcRenderer.send("ytmView:addonMessage", addonId, name, payload),
  ...(YTMD_DEV_TOOLS ? { sendDevProbe: (batch: unknown[]) => ipcRenderer.send("ytmView:devProbe", batch) } : {})
});

function createStyleSheet() {
  const css = document.createElement("style");
  css.appendChild(
    document.createTextNode(`
      .ytmd-history-back, .ytmd-history-forward {
        cursor: pointer;
        margin: 0 18px 0 2px;
        font-size: 24px;
        color: rgba(255, 255, 255, 0.5);
      }

      .ytmd-history-back.pivotbar, .ytmd-history-forward.pivotbar {
        padding-top: 12px;
      }

      .ytmd-history-back.disabled, .ytmd-history-forward.disabled {
        cursor: not-allowed;
      }

      .ytmd-history-back:hover:not(.disabled), .ytmd-history-forward:hover:not(.disabled) {
        color: #FFFFFF;
      }

      .ytmd-hidden {
        display: none;
      }

      .ytmd-persist-volume-slider {
        opacity: 1 !important;
        pointer-events: initial !important;
      }
      
      .ytmd-player-bar-control.library-button {
        margin-left: 8px;
      }

      .ytmd-player-bar-control.library-button.hidden {
        display: none;
      }

      .ytmd-player-bar-control.playlist-button {
        margin-left: 8px;
      }

      .ytmd-player-bar-control.playlist-button.hidden {
        display: none;
      }

      .ytmd-player-bar-control.sleep-timer-button.active {
        color: #FFFFFF;
      }
    `)
  );
  document.head.appendChild(css);
}

function createMaterialSymbolsLink() {
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100,0,0";
  return link;
}

function createNavigationMenuArrows() {
  // Go back in history
  const historyBackElement = document.createElement("span");
  historyBackElement.classList.add("material-symbols-outlined", "ytmd-history-back", "disabled");
  historyBackElement.innerText = "west";

  historyBackElement.addEventListener("click", function () {
    if (!historyBackElement.classList.contains("disabled")) {
      history.back();
    }
  });

  // Go forward in history
  const historyForwardElement = document.createElement("span");
  historyForwardElement.classList.add("material-symbols-outlined", "ytmd-history-forward", "disabled");
  historyForwardElement.innerText = "east";

  historyForwardElement.addEventListener("click", function () {
    if (!historyForwardElement.classList.contains("disabled")) {
      history.forward();
    }
  });

  ipcRenderer.on("ytmView:navigationStateChanged", (event, state) => {
    if (state.canGoBack) {
      historyBackElement.classList.remove("disabled");
    } else {
      historyBackElement.classList.add("disabled");
    }

    if (state.canGoForward) {
      historyForwardElement.classList.remove("disabled");
    } else {
      historyForwardElement.classList.add("disabled");
    }
  });

  const pivotBar = document.querySelector("ytmusic-pivot-bar-renderer");
  if (!pivotBar) {
    // New YTM UI
    const searchBar = document.querySelector("ytmusic-search-box");
    const navBar = searchBar.parentNode;
    navBar.insertBefore(historyForwardElement, searchBar);
    navBar.insertBefore(historyBackElement, historyForwardElement);
  } else {
    historyForwardElement.classList.add("pivotbar");
    historyBackElement.classList.add("pivotbar");
    pivotBar.prepend(historyForwardElement);
    pivotBar.prepend(historyBackElement);
  }
}

function createKeyboardNavigation() {
  const keyboardNavigation = document.createElement("div");
  keyboardNavigation.tabIndex = 32767;
  keyboardNavigation.onfocus = () => {
    keyboardNavigation.blur();
    ipcRenderer.send("ytmView:switchFocus", "main");
  };
  document.body.appendChild(keyboardNavigation);
}

async function createAdditionalPlayerBarControls() {
  (await webFrame.executeJavaScript(playerBarControlsScript))();
}

async function hideChromecastButton() {
  (
    await webFrame.executeJavaScript(`
      (function() {
        window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_CAST_AVAILABLE', payload: false });
      })
    `)
  )();
}

async function hookPlayerApiEvents() {
  (await webFrame.executeJavaScript(hookPlayerApiEventsScript))();
}

function overrideHistoryButtonDisplay() {
  document.querySelector<HTMLElement>("#history-link .history-button").style = "display: inline-block !important;";
}

function getYTMTextRun(runs: { text: string }[]) {
  let final = "";
  for (const run of runs) {
    final += run.text;
  }
  return final;
}

// This hooks YTM's internal store. YouTube Music defines
// PolymerFakeBaseClassWithoutHtml itself, so whichever side defines the
// property first wins. executeInMainWorld runs synchronously during preload,
// before the page can execute anything, which webFrame.executeJavaScript does
// not guarantee: with the service worker serving the page from cache, YTM's
// scripts could win that race and the store hook would never install.
contextBridge.executeInMainWorld({
  func: () => {
    type YTMStore = { getState: () => unknown; dispatch: (action: unknown) => unknown; subscribe: (callback: () => void) => unknown };
    const hookWindow = window as typeof window & { __YTMD_HOOK__?: Readonly<{ ytmStore: YTMStore }> };
    const fakeBaseClass = function (this: { store?: YTMStore }) {
      try {
        if (!hookWindow.__YTMD_HOOK__) {
          if (this.store && !!this.store.getState && !!this.store.dispatch && !!this.store.subscribe) {
            const ytmdHook = {
              ytmStore: this.store
            };
            Object.freeze(ytmdHook);
            hookWindow.__YTMD_HOOK__ = ytmdHook;
          }
        }
      } catch {
        // Never let the trap break YTM's own bootstrap.
      }
    };
    Object.defineProperty(window, "PolymerFakeBaseClassWithoutHtml", {
      set: () => undefined,
      get: () => fakeBaseClass
    });
  }
});

// One Web Audio graph for the whole page. createMediaElementSource permanently
// reroutes the element and may only be called once, so every feature that wants
// the audio shares this and none of them may build their own.
//
//   source -> out -> destination
//
// `out` is the junction everything on the ear path terminates into, and nothing
// but its owner ever disconnects it. Room capture splices its own node in ahead
// of `out`, so anything hanging off the far side of it, such as the volume
// boost, survives a room starting or stopping. Page scripts cannot import each
// other, so the graph is built here rather than copied into each of them.
contextBridge.executeInMainWorld({
  func: () => {
    type AudioGraph = { context: AudioContext; source: MediaElementAudioSourceNode; out: GainNode };
    const graphWindow = window as typeof window & { __ytmdAudioGraph?: AudioGraph; __ytmdEnsureAudioGraph?: () => AudioGraph | null };

    graphWindow.__ytmdEnsureAudioGraph = () => {
      let graph = graphWindow.__ytmdAudioGraph;
      if (!graph) {
        const video = document.querySelector("video");
        if (!video) return null;

        const context = new AudioContext();
        const source = context.createMediaElementSource(video);
        const out = context.createGain();
        source.connect(out);
        out.connect(context.destination);

        graph = { context, source, out };
        graphWindow.__ytmdAudioGraph = graph;
      }
      // Routing an element into a suspended context silences it outright.
      if (graph.context.state === "suspended") graph.context.resume();
      return graph;
    };
  }
});

// Hook setup starts at DOMContentLoaded rather than the load event: a watch
// page with paused media can hold the load event open indefinitely, and the
// polls below already wait for everything they need.

// Runs one optional setup module. The loading overlay waits on ytmView:loaded,
// so a throw between the essential hook stages and that signal would leave the
// whole app on the spinner over a single broken module; these fail alone,
// loudly, and let the rest of the setup finish.
const optionalModule = async (name: string, fn: () => void | Promise<void>) => {
  try {
    await fn();
  } catch (error) {
    console.error(`[ytmd] optional module '${name}' failed`, error);
    ipcRenderer.send("ytmView:optionalModuleFailed", name, String(error));
  }
};

const startHooking = async () => {
  console.debug(`[ytmd] hook setup starting for ${window.location.hostname} (readyState=${document.readyState})`);
  if (window.location.hostname !== "music.youtube.com") {
    if (window.location.hostname === "consent.youtube.com" || window.location.hostname === "accounts.google.com") {
      ipcRenderer.send("ytmView:loaded");
    }
    return;
  }

  const storeHook = await pollUntil<boolean>(
    async () => (await webFrame.executeJavaScript(brokenHookStage === "store-hook" ? failingBooleanProbeSource : storeHookProbeSource))(),
    hooked => hooked,
    HOOK_POLL_INTERVAL,
    HOOK_POLL_MAX_ATTEMPTS
  );
  console.debug(`[ytmd] hook stage store-hook: done=${storeHook.done} attempts=${storeHook.attempts} lastError=${storeHook.lastError}`);
  if (!storeHook.done) {
    ipcRenderer.send("ytmView:hookFailed", "store-hook", { attempts: storeHook.attempts, lastError: storeHook.lastError });
    return;
  }

  let materialSymbolsLoaded = false;

  const materialSymbols = createMaterialSymbolsLink();
  materialSymbols.onload = () => {
    materialSymbolsLoaded = true;
  };
  document.head.appendChild(materialSymbols);

  const playerBar = await pollUntil<PlayerBarProbeSnapshot>(
    async () => (await webFrame.executeJavaScript(brokenHookStage === "player-api" ? failingPlayerBarProbeSource : playerBarProbeSource))(),
    snapshot => snapshot.playerApiReady,
    HOOK_POLL_INTERVAL,
    HOOK_POLL_MAX_ATTEMPTS
  );
  console.debug(`[ytmd] hook stage player-api: done=${playerBar.done} attempts=${playerBar.attempts} lastError=${playerBar.lastError}`);
  if (!playerBar.done) {
    ipcRenderer.send("ytmView:hookFailed", "player-api", { attempts: playerBar.attempts, lastError: playerBar.lastError, ...playerBar.last });
    return;
  }

  // The icon font is cosmetic: give it a bounded grace period but never let it
  // block the app from finishing setup.
  await pollUntil<boolean>(
    async () => materialSymbolsLoaded,
    loaded => loaded,
    HOOK_POLL_INTERVAL,
    40
  );

  await optionalModule("style-sheet", () => createStyleSheet());
  await optionalModule("navigation-arrows", () => createNavigationMenuArrows());
  await optionalModule("keyboard-navigation", () => createKeyboardNavigation());
  await optionalModule("player-bar-controls", () => createAdditionalPlayerBarControls());
  await optionalModule("hide-chromecast-button", () => hideChromecastButton());
  await hookPlayerApiEvents();
  await optionalModule("history-button-display", () => overrideHistoryButtonDisplay());

  const integrationScripts: ScriptTable = {};
  // Scripts registered after this page load arrive as pushes. The listener
  // attaches before the snapshot so a registration in flight is never lost;
  // merging the same script twice is idempotent.
  ipcRenderer.on("ytmView:scriptRegistered", (_event, namespace: string, name: string, script: string) => {
    mergeScript(integrationScripts, namespace, name, script);
  });
  const scriptSnapshot: ScriptTable = await ipcRenderer.invoke("ytmView:getIntegrationScripts");
  for (const [namespace, scripts] of Object.entries(scriptSnapshot)) {
    for (const [name, script] of Object.entries(scripts)) mergeScript(integrationScripts, namespace, name, script);
  }

  await optionalModule("continue-where-you-left-off", async () => {
    const state = await store.get("state");
    const playbackSettings = await store.get("playback");
    const continueWhereYouLeftOff = playbackSettings.continueWhereYouLeftOff;

    if (continueWhereYouLeftOff) {
      if (playbackSettings.continueWhereYouLeftOffPaused && state.lastVideoId) {
        // The restore is allowed to autoplay so YTM never shows its blocked
        // autoplay hint. Mute before it starts; the main process pauses it the
        // moment it reports playing and then restores the mute state.
        const wasMuted: boolean = (
          await webFrame.executeJavaScript(`
          (function() {
            const playerApi = document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi;
            const muted = playerApi.isMuted();
            playerApi.mute();
            return muted;
          })
        `)
        )();
        ipcRenderer.send("ytmView:launchPauseArmed", state.lastVideoId, wasMuted);
      }

      // The last page the user was on is already a page where it will be playing a song from (no point telling YTM to play it again)
      if (!state.lastUrl.startsWith("https://music.youtube.com/watch")) {
        if (state.lastVideoId) {
          document.dispatchEvent(
            new CustomEvent("yt-navigate", {
              detail: {
                endpoint: {
                  watchEndpoint: {
                    videoId: state.lastVideoId,
                    playlistId: state.lastPlaylistId
                  }
                }
              }
            })
          );
        }
      } else {
        (
          await webFrame.executeJavaScript(`
          (function() {
            window.ytmd.sendVideoData(document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.getPlayerResponse().videoDetails, document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.getPlaylistId());
          })
        `)
        )();
      }
    }
  });

  await optionalModule("persist-volume-slider", async () => {
    const alwaysShowVolumeSlider = (await store.get("appearance")).alwaysShowVolumeSlider;
    if (alwaysShowVolumeSlider) {
      document.querySelector(`${PLAYER_BAR_SELECTOR} #volume-slider`).classList.add("ytmd-persist-volume-slider");
    }
  });

  ipcRenderer.on("remoteControl:execute", async (_event, command, value) => {
    switch (command) {
      case "playPause": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              const playerBar = document.querySelector("${PLAYER_BAR_SELECTOR}");
              if (playerBar.playing) {
                // NonStop holds YTM's inactivity pause back; this is not one of those.
                window.__ytmdNonStopAllowPause = true;
                playerBar.playerApi.pauseVideo();
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
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.playVideo();
            })
          `)
        )();
        break;
      }

      case "pause": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              // NonStop holds YTM's inactivity pause back; this is not one of those.
              window.__ytmdNonStopAllowPause = true;
              document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.pauseVideo();
            })
          `)
        )();
        break;
      }

      case "next": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.nextVideo();
            })
          `)
        )();
        break;
      }

      case "previous": {
        (
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.previousVideo();
            })
          `)
        )();
        break;
      }

      case "toggleLike": {
        (await webFrame.executeJavaScript(toggleLikeScript))();
        break;
      }

      case "toggleDislike": {
        (await webFrame.executeJavaScript(toggleDislikeScript))();
        break;
      }

      case "volumeUp": {
        const currentVolumeUp: number = (
          await webFrame.executeJavaScript(`
            (function() {
              return document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.getVolume();
            })
          `)
        )();

        let newVolumeUp = currentVolumeUp + 10;
        if (currentVolumeUp > 100) {
          newVolumeUp = 100;
        }
        (
          await webFrame.executeJavaScript(`
            (function(newVolumeUp) {
              document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.setVolume(newVolumeUp);
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: newVolumeUp });
            })
          `)
        )(newVolumeUp);
        break;
      }

      case "volumeDown": {
        const currentVolumeDown: number = (
          await webFrame.executeJavaScript(`
            (function() {
              return document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.getVolume();
            })
          `)
        )();

        let newVolumeDown = currentVolumeDown - 10;
        if (currentVolumeDown < 0) {
          newVolumeDown = 0;
        }
        (
          await webFrame.executeJavaScript(`
            (function(newVolumeDown) {
              document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.setVolume(newVolumeDown);
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_VOLUME', payload: newVolumeDown });
            })
          `)
        )(newVolumeDown);
        break;
      }

      case "setVolume": {
        const valueInt: number = parseInt(value);
        // Check if Volume is a number and between 0 and 100
        if (isNaN(valueInt) || valueInt < 0 || valueInt > 100) {
          return;
        }

        (
          await webFrame.executeJavaScript(`
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
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.mute();
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_MUTED', payload: true });
            })
          `)
        )();
        break;

      case "unmute":
        (
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.unMute();
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_MUTED', payload: false });
            })
          `)
        )();
        break;

      case "repeatMode":
        (
          await webFrame.executeJavaScript(`
            (function(value) {
              window.__YTMD_HOOK__.ytmStore.dispatch({ type: 'SET_REPEAT', payload: value });
            })
          `)
        )(value);
        break;

      case "seekTo":
        (
          await webFrame.executeJavaScript(`
            (function(value) {
              document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi.seekTo(value);
            })
          `)
        )(value);
        break;

      case "shuffle":
        (
          await webFrame.executeJavaScript(`
            (function() {
              document.querySelector("${PLAYER_BAR_SELECTOR}").queue.shuffle();
            })
          `)
        )();
        break;

      case "playQueueIndex": {
        const index: number = parseInt(value);

        (
          await webFrame.executeJavaScript(`
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
              endpoint
            }
          })
        );
        break;
      }
    }
  });

  ipcRenderer.on("ytmView:getPlaylists", async (_event, requestId) => {
    const rawPlaylists = await (await webFrame.executeJavaScript(getPlaylistsScript))();

    const playlists = [];
    for (const rawPlaylist of rawPlaylists) {
      const playlist = rawPlaylist.playlistAddToOptionRenderer;
      playlists.push({
        id: playlist.playlistId,
        title: getYTMTextRun(playlist.title.runs)
      });
    }
    ipcRenderer.send(`ytmView:getPlaylists:response:${requestId}`, playlists);
  });

  store.onDidAnyChange(newState => {
    if (newState.appearance.alwaysShowVolumeSlider) {
      const volumeSlider = document.querySelector("#volume-slider");
      if (!volumeSlider.classList.contains("ytmd-persist-volume-slider")) {
        volumeSlider.classList.add("ytmd-persist-volume-slider");
      }
    } else {
      const volumeSlider = document.querySelector("#volume-slider");
      if (volumeSlider.classList.contains("ytmd-persist-volume-slider")) {
        volumeSlider.classList.remove("ytmd-persist-volume-slider");
      }
    }
  });

  ipcRenderer.on("ytmView:refitPopups", async () => {
    // Update 4/14/2024: Broken until a hook is provided for this
    /*
    (
      await webFrame.executeJavaScript(`
        (function() {
          document.querySelector("ytmusic-popup-container").refitPopups_();
        })
      `)
    )();
    */
  });

  ipcRenderer.on("ytmView:executeScript", async (_event, integrationName, scriptName) => {
    const scripts = integrationScripts[integrationName];
    if (scripts) {
      const script = scripts[scriptName];
      if (script) {
        (await webFrame.executeJavaScript(script))();
      }
    }
  });

  ipcRenderer.on("ytmView:invokeScript", async (_event, integrationName, scriptName, requestId, arg) => {
    const respond = (payload: { ok: boolean; value?: unknown; error?: string }) => ipcRenderer.send(`ytmView:invokeScript:response:${requestId}`, payload);
    try {
      const script = integrationScripts[integrationName]?.[scriptName];
      if (!script) {
        respond({ ok: false, error: `unknown script ${integrationName}/${scriptName}` });
        return;
      }
      const value = await (await webFrame.executeJavaScript(script))(arg);
      respond({ ok: true, value });
    } catch (error) {
      respond({ ok: false, error: String(error) });
    }
  });

  if (YTMD_DEV_TOOLS) {
    await optionalModule("dev-probe", async () => {
      if (ipcRenderer.sendSync("ytmView:devProbeEnabled") === true) {
        (await webFrame.executeJavaScript(devProbeScript))();
      }
    });
  }

  ipcRenderer.send("ytmView:loaded");
};

// A crash anywhere in setup must surface as the hook-failure overlay, not an
// endless loading spinner: the main process only clears loading on
// ytmView:loaded or ytmView:hookFailed.
const startHookingSafely = () => {
  startHooking().catch(error => {
    console.error("[ytmd] hook setup crashed", error);
    ipcRenderer.send("ytmView:hookFailed", "unexpected", { error: String(error) });
  });
};

if (document.readyState !== "loading") {
  startHookingSafely();
} else {
  document.addEventListener("DOMContentLoaded", () => {
    startHookingSafely();
  });
}
