import { BrowserView } from "electron";
import log from "electron-log";

import playerStateStore from "../player-state-store";
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

export function sendPlaybackCommand(command: string, value?: unknown) {
  const view = getYtmView();
  if (!view || view.webContents.isDestroyed()) return false;
  view.webContents.send("remoteControl:execute", command, value);
  return true;
}

export async function cueTrack(request: CueRequest): Promise<CueResult> {
  const result = await trackCue.cue(request);
  log.info(`Track cue for ${request.videoId} finished: ${result}`);
  return result;
}

export function cancelCue() {
  trackCue.cancel();
}
