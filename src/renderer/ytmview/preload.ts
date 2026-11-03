import type { AppWindow } from "../app-window";
declare const window: AppWindow;
import { executeRemoteCommand } from "./remote-control";
import { executePageScript, readPageValue, onAsyncMessage } from "./execute-page-script";
import { isArray, isRecord } from "~shared/unknown";
import { arrayOf, isBoolean, isString, objectOf, recordOf } from "~shared/validation";
import { invokeValue } from "../ipc-values";
import { storeGuards } from "~shared/store/validate-settings";
import { installMainWorldHooks } from "./main-world";
import {
  createThemeStyleSheet,
  createStyleSheet,
  createMaterialSymbolsLink,
  createNavigationMenuArrows,
  createKeyboardNavigation,
  createAdditionalPlayerBarControls,
  hideChromecastButton,
  hookPlayerApiEvents,
  overrideHistoryButtonDisplay,
  getYTMTextRun,
} from "./page-controls";
import { contextBridge, ipcRenderer, webFrame } from "electron";
import { Store } from "../store-ipc/store";
import { type StoreSchema } from "~shared/store/schema";
import {
  HOOK_POLL_INTERVAL,
  HOOK_POLL_MAX_ATTEMPTS,
  PLAYER_BAR_SELECTOR,
  type PlayerBarProbeSnapshot,
  isPlayerBarProbeSnapshot,
  playerBarProbeSource,
  pollUntil,
  storeHookProbeSource,
} from "~shared/hook-probes";
import { mergeScript, type ScriptTable } from "./script-table";

import getPlaylistsScript from "./scripts/getplaylists.script?raw";
import devProbeScript from "./scripts/devprobe.script?raw";

declare const isYtmdDevTools: boolean;

const store = new Store<StoreSchema>(storeGuards);

const brokenHookStage: unknown = process.argv.includes("--ytmd-test") ? ipcRenderer.sendSync("ytmdTest:getBrokenHookStage") : null;
const failingBooleanProbeSource = `(function() { return false; })`;
const failingPlayerBarProbeSource = `(function() { return { playerBarPresent: false, miniplayerPresent: false, playerApiPresent: false, playerApiReady: false, resolverPresent: false, resolveError: null, resolvedVia: null, candidateKeys: [], missingMembers: [] }; })`;

const MAX_CONTRACT_MISSES = 50;
const reportedContractMisses = new Set<string>();

const reportContractMiss = (what: string, detail?: unknown) => {
  const key = what;
  if (reportedContractMisses.has(key) || reportedContractMisses.size >= MAX_CONTRACT_MISSES) return;
  reportedContractMisses.add(key);
  const detailText = String(detail);
  ipcRenderer.send("ytmView:contractMiss", key, detail === undefined ? undefined : detailText);
};

contextBridge.exposeInMainWorld("ytmd", {
  sendVideoProgress: (volume: number) => ipcRenderer.send("ytmView:videoProgressChanged", volume),
  sendVideoState: (state: number) => ipcRenderer.send("ytmView:videoStateChanged", state),
  sendVideoData: (videoDetails: unknown, playlistId: string, album: { id: string; text: string }, likeStatus: unknown, hasFullMetadata: boolean) =>
    ipcRenderer.send("ytmView:videoDataChanged", videoDetails, playlistId, album, likeStatus, hasFullMetadata),
  sendQueueUpdate: (queue: unknown) => ipcRenderer.send("ytmView:queueChanged", queue),
  sendStoreUpdate: (likeStatus: string, volume: number, isMuted: boolean, isAdPlaying: boolean) =>
    ipcRenderer.send("ytmView:storeStateChanged", likeStatus, volume, isMuted, isAdPlaying),
  sendCreatePlaylistObservation: (playlist: unknown) => ipcRenderer.send("ytmView:createPlaylistObserved", playlist),
  sendDeletePlaylistObservation: (playlistId: string) => ipcRenderer.send("ytmView:deletePlaylistObserved", playlistId),

  postAddonMessage: (addonId: string, name: string, payload?: unknown) => ipcRenderer.send("ytmView:addonMessage", addonId, name, payload),
  sendAdBlockEvent: (kind: string, detail?: unknown) => ipcRenderer.send("ytmView:adBlockEvent", kind, detail),
  reportContractMiss: (what: string, detail?: unknown) => reportContractMiss(what, detail),
  ...(isYtmdDevTools ? { sendDevProbe: (batch: unknown[]) => ipcRenderer.send("ytmView:devProbe", batch) } : {}),
});

window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== "https://music.youtube.com") return;
  if (!isRecord(event.data) || event.data.type !== "ytmd-room-capture-port" || !event.ports[0]) return;
  ipcRenderer.postMessage("ytmView:roomCapturePort", null, [event.ports[0]]);
});

installMainWorldHooks();

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
    () => readPageValue(brokenHookStage === "store-hook" ? failingBooleanProbeSource : storeHookProbeSource, isBoolean),
    (isHooked) => isHooked,
    HOOK_POLL_INTERVAL,
    HOOK_POLL_MAX_ATTEMPTS
  );
  console.debug(`[ytmd] hook stage store-hook: done=${storeHook.done} attempts=${storeHook.attempts} lastError=${storeHook.lastError}`);
  if (!storeHook.done) {
    ipcRenderer.send("ytmView:hookFailed", "store-hook", { attempts: storeHook.attempts, lastError: storeHook.lastError });
    return;
  }

  let isMaterialSymbolsLoaded = false;

  const materialSymbols = createMaterialSymbolsLink();
  materialSymbols.onload = () => {
    isMaterialSymbolsLoaded = true;
  };
  document.head.appendChild(materialSymbols);

  const playerBar = await pollUntil<PlayerBarProbeSnapshot>(
    () => readPageValue(brokenHookStage === "player-api" ? failingPlayerBarProbeSource : playerBarProbeSource, isPlayerBarProbeSnapshot),
    (snapshot) => snapshot.playerApiReady,
    HOOK_POLL_INTERVAL,
    HOOK_POLL_MAX_ATTEMPTS
  );
  console.debug(
    `[ytmd] hook stage player-api: done=${playerBar.done} attempts=${playerBar.attempts} resolvedVia=${playerBar.last?.resolvedVia} lastError=${playerBar.lastError}`
  );
  if (!playerBar.done) {
    ipcRenderer.send("ytmView:hookFailed", "player-api", { attempts: playerBar.attempts, lastError: playerBar.lastError, ...playerBar.last });
    return;
  }

  if (playerBar.last && playerBar.last.resolvedVia !== "property" && playerBar.last.resolvedVia !== "resolver") {
    reportContractMiss(`playerApi resolved via ${playerBar.last.resolvedVia}`, playerBar.last.candidateKeys.join(","));
  }
  if (playerBar.last && playerBar.last.missingMembers.length > 0) {
    reportContractMiss(`playerApi missing ${playerBar.last.missingMembers.join(",")}`);
  }

  const integrationScripts: ScriptTable = {};

  ipcRenderer.on("ytmView:scriptRegistered", (_event, namespace: string, name: string, script: string) => {
    mergeScript(integrationScripts, namespace, name, script);
  });
  const scriptSnapshot = await invokeValue("ytmView:getIntegrationScripts", recordOf(recordOf(isString)));
  for (const [namespace, scripts] of Object.entries(scriptSnapshot)) {
    for (const [name, script] of Object.entries(scripts)) mergeScript(integrationScripts, namespace, name, script);
  }

  onAsyncMessage("ytmView:executeScript", async (_event, integrationName, scriptName) => {
    if (typeof integrationName !== "string" || typeof scriptName !== "string") return;
    const scripts = integrationScripts[integrationName];
    if (scripts) {
      const script = scripts[scriptName];
      if (script) {
        (await executePageScript(script))();
      }
    }
  });

  onAsyncMessage("ytmView:invokeScript", async (_event, integrationName, scriptName, requestId, arg) => {
    if (typeof integrationName !== "string" || typeof scriptName !== "string" || (typeof requestId !== "string" && typeof requestId !== "number")) return;
    const respond = (payload: { ok: boolean; value?: unknown; error?: string }) => ipcRenderer.send(`ytmView:invokeScript:response:${requestId}`, payload);
    try {
      const script = integrationScripts[integrationName]?.[scriptName];
      if (!script) {
        respond({ ok: false, error: `unknown script ${integrationName}/${scriptName}` });
        return;
      }
      const value = await (await executePageScript(script))(arg);
      respond({ ok: true, value });
    } catch (error) {
      respond({ ok: false, error: String(error) });
    }
  });

  await pollUntil<boolean>(
    () => Promise.resolve(isMaterialSymbolsLoaded),
    (isLoaded) => isLoaded,
    HOOK_POLL_INTERVAL,
    40
  );

  await optionalModule("style-sheet", () => createStyleSheet());
  await optionalModule("theme", () => createThemeStyleSheet());
  await optionalModule("navigation-arrows", () => createNavigationMenuArrows());
  await optionalModule("keyboard-navigation", () => createKeyboardNavigation());
  await optionalModule("player-bar-controls", () => createAdditionalPlayerBarControls());
  await optionalModule("hide-chromecast-button", () => hideChromecastButton());
  await hookPlayerApiEvents();
  await optionalModule("history-button-display", () => overrideHistoryButtonDisplay());

  await optionalModule("continue-where-you-left-off", async () => {
    const state = await store.get("state");
    const playbackSettings = await store.get("playback");
    const isContinueWhereYouLeftOff = playbackSettings.continueWhereYouLeftOff;

    if (isContinueWhereYouLeftOff) {
      if (playbackSettings.continueWhereYouLeftOffPaused && state.lastVideoId) {
        const wasMuted = (
          await executePageScript(`
          (function() {
            const playerApi = document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi;
            const muted = playerApi.isMuted();
            playerApi.mute();
            return muted;
          })
        `)
        )();
        if (typeof wasMuted !== "boolean") throw new TypeError("Invalid player mute state");
        ipcRenderer.send("ytmView:launchPauseArmed", state.lastVideoId, wasMuted);
      }

      if (!state.lastUrl.startsWith("https://music.youtube.com/watch")) {
        if (state.lastVideoId) {
          document.dispatchEvent(
            new CustomEvent("yt-navigate", {
              detail: {
                endpoint: {
                  watchEndpoint: {
                    videoId: state.lastVideoId,
                    playlistId: state.lastPlaylistId,
                  },
                },
              },
            })
          );
        }
      } else {
        (
          await executePageScript(`
          (function() {
            const playerApi = document.querySelector("${PLAYER_BAR_SELECTOR}").playerApi;
            const videoDetails = playerApi.getPlayerResponse()?.videoDetails;
            if (videoDetails) window.ytmd.sendVideoData(videoDetails, playerApi.getPlaylistId());
          })
        `)
        )();
      }
    }
  });

  await optionalModule("persist-volume-slider", async () => {
    const isAlwaysShowVolumeSlider = (await store.get("appearance")).alwaysShowVolumeSlider;
    if (isAlwaysShowVolumeSlider) {
      document.querySelector(`${PLAYER_BAR_SELECTOR} #volume-slider`)?.classList.add("ytmd-persist-volume-slider");
    }
  });

  onAsyncMessage("remoteControl:execute", async (_event, command, value) => {
    await executeRemoteCommand(command, value);
  });

  onAsyncMessage("ytmView:getPlaylists", async (_event, requestId) => {
    if (typeof requestId !== "number" && typeof requestId !== "string") return;
    const rawPlaylists = await (await executePageScript(getPlaylistsScript))();

    if (!isArray(rawPlaylists)) throw new TypeError("Invalid playlist response");
    const isPlaylist = objectOf<{ playlistId: string; title: { runs: { text: string }[] } }>({
      playlistId: isString,
      title: objectOf({ runs: arrayOf(objectOf({ text: isString })) }),
    });
    const playlists = [];
    for (const rawPlaylist of rawPlaylists) {
      const playlist = isRecord(rawPlaylist) ? rawPlaylist.playlistAddToOptionRenderer : undefined;
      if (!isPlaylist(playlist)) throw new TypeError("Invalid playlist entry");
      playlists.push({
        id: playlist.playlistId,
        title: getYTMTextRun(playlist.title.runs),
      });
    }
    ipcRenderer.send(`ytmView:getPlaylists:response:${requestId}`, playlists);
  });

  store.onDidAnyChange((newState) => {
    webFrame.executeJavaScript(`window.__ytmdAdPrune && (window.__ytmdAdPrune.enabled = ${newState.playback.adBlockerEnabled});`).catch((error: unknown) => {
      console.warn("preload: operation failed", error);
      return undefined;
    });

    const volumeSlider = document.querySelector(`${PLAYER_BAR_SELECTOR} #volume-slider`);
    if (!volumeSlider) {
      reportContractMiss(`${PLAYER_BAR_SELECTOR} #volume-slider`);
    } else if (newState.appearance.alwaysShowVolumeSlider) {
      volumeSlider.classList.add("ytmd-persist-volume-slider");
    } else {
      volumeSlider.classList.remove("ytmd-persist-volume-slider");
    }
  });

  if (isYtmdDevTools) {
    await optionalModule("dev-probe", async () => {
      if (ipcRenderer.sendSync("ytmView:devProbeEnabled") === true) {
        (await executePageScript(devProbeScript))();
      }
    });
  }

  ipcRenderer.send("ytmView:loaded");
};

const startHookingSafely = () => {
  void startHooking().catch((error: unknown) => {
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
