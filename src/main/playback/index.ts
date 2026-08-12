import { BrowserView, ipcMain } from "electron";
import log from "electron-log";
import crypto from "crypto";

import playerStateStore from "../player-state-store";
import { validateRemoteCommand } from "~shared/remote-commands";
import type { RemoteCommandName } from "~shared/addons/sdk";
import { createTrackCue, type CueRequest, type CueResult } from "./cue-track";

let getYtmView: () => BrowserView | null = () => null;

const trackCue = createTrackCue({
  getState: () => playerStateStore.getState(),
  addEventListener: listener => playerStateStore.addEventListener(listener),
  removeEventListener: listener => playerStateStore.removeEventListener(listener),
  send: (command, value) => {
    const view = getYtmView();
    if (!view || view.webContents.isDestroyed()) return false;
    view.webContents.send("remoteControl:execute", command, value);
    return true;
  },
  now: () => Date.now()
});

export function providePlaybackView(getter: () => BrowserView | null) {
  getYtmView = getter;
}

export function sendPlaybackCommand(command: RemoteCommandName, value?: unknown) {
  const problem = validateRemoteCommand(command, value);
  if (problem) throw new TypeError(`sendPlaybackCommand(${command}): ${problem}`);
  const view = getYtmView();
  if (!view || view.webContents.isDestroyed()) return false;
  view.webContents.send("remoteControl:execute", command, value);
  return true;
}

/** The signed-in account's playlists, fetched live from the page. */
export function getPlaylists(): Promise<{ id: string; title: string }[]> {
  return new Promise((resolve, reject) => {
    const view = getYtmView();
    if (!view || view.webContents.isDestroyed()) {
      reject(new Error("YTM view unavailable"));
      return;
    }
    const requestId = crypto.randomUUID();
    const channel = `ytmView:getPlaylists:response:${requestId}`;
    const listener = (event: Electron.IpcMainEvent, playlists: { id: string; title: string }[]) => {
      if (event.sender !== view.webContents) return;
      clearTimeout(timeout);
      resolve(playlists);
    };
    const timeout = setTimeout(() => {
      ipcMain.removeListener(channel, listener);
      reject(new Error("Playlist request timed out"));
    }, 15 * 1000);
    ipcMain.once(channel, listener);
    view.webContents.send("ytmView:getPlaylists", requestId);
  });
}

export async function cueTrack(request: CueRequest): Promise<CueResult> {
  const result = await trackCue.cue(request);
  log.info(`Track cue for ${request.videoId} finished: ${result}`);
  return result;
}

export function cancelCue() {
  trackCue.cancel();
}
