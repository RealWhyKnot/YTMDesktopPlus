import { nativeImage, type NativeImage } from "electron";
import type Conf from "conf";
import playerStateStore, { PlayerState, VideoState } from "./player-state-store";
import type { StoreSchema } from "../shared/store/schema";

export interface TaskbarDeps {
  store: Conf<StoreSchema>;
  getMainWindow(): Electron.BrowserWindow | null;
  sendRemoteCommand(command: string): void;
  getControlsIconPath(icon: string): string;
}

export type TaskbarIcons = { previous: NativeImage; play: NativeImage; pause: NativeImage; next: NativeImage };

type ProgressBarMode = "normal" | "paused";

export type TaskbarWindow = {
  isVisible(): boolean;
  setThumbarButtons(buttons: Electron.ThumbarButton[]): boolean;
  setProgressBar(progress: number, options?: { mode: ProgressBarMode }): void;
  on(event: "show", listener: () => void): unknown;
};

export type TaskbarUpdaterDeps = {
  icons: TaskbarIcons | null;
  sendRemoteCommand(command: string): void;
  progressEnabled(): boolean;
};

const PROGRESS_STEPS = 200;

export function progressBarFrame(state: PlayerState): { value: number; mode: ProgressBarMode } {
  const mode: ProgressBarMode = state.trackState === VideoState.Playing ? "normal" : "paused";
  const duration = state.videoDetails?.durationSeconds ?? 0;
  if (!state.videoDetails || !(duration > 0)) return { value: -1, mode };
  const fraction = Math.min(1, Math.max(0, state.videoProgress / duration));
  return { value: Math.round(fraction * PROGRESS_STEPS) / PROGRESS_STEPS, mode };
}

export function createTaskbarUpdater(deps: TaskbarUpdaterDeps) {
  let window: TaskbarWindow | null = null;
  let appliedButtons: string | null = null;
  let appliedProgress: string | null = null;
  let lastState: PlayerState | null = null;

  const buttons = (hasVideo: boolean, isPlaying: boolean, icons: TaskbarIcons): Electron.ThumbarButton[] => {
    const flags: Electron.ThumbarButton["flags"] = hasVideo ? [] : ["disabled"];
    return [
      { tooltip: "Previous", icon: icons.previous, flags, click: () => deps.sendRemoteCommand("previous") },
      { tooltip: "Play/Pause", icon: isPlaying ? icons.pause : icons.play, flags, click: () => deps.sendRemoteCommand("playPause") },
      { tooltip: "Next", icon: icons.next, flags, click: () => deps.sendRemoteCommand("next") }
    ];
  };

  const update = (target: TaskbarWindow | null, state: PlayerState) => {
    lastState = state;
    if (!target) return;
    if (target !== window) {
      window = target;
      appliedButtons = null;
      appliedProgress = null;
      target.on("show", () => {
        if (window === target && lastState) update(target, lastState);
      });
    }

    const hasVideo = !!state.videoDetails;
    const isPlaying = state.trackState === VideoState.Playing;
    if (deps.icons && target.isVisible()) {
      const key = `${hasVideo}:${isPlaying}`;
      if (key !== appliedButtons) {
        target.setThumbarButtons(buttons(hasVideo, isPlaying, deps.icons));
        appliedButtons = key;
      }
    }

    if (deps.progressEnabled()) {
      const frame = progressBarFrame(state);
      const key = `${frame.value}:${frame.mode}`;
      if (key !== appliedProgress) {
        target.setProgressBar(frame.value, { mode: frame.mode });
        appliedProgress = key;
      }
    }
  };

  const clearProgress = () => {
    window?.setProgressBar(-1);
    appliedProgress = null;
  };

  return { update, clearProgress };
}

export function setupTaskbarFeatures(deps: TaskbarDeps): void {
  const { store, getMainWindow, sendRemoteCommand, getControlsIconPath } = deps;

  const icons: TaskbarIcons | null =
    process.platform === "win32"
      ? {
          previous: nativeImage.createFromPath(getControlsIconPath("play-previous-button.png")),
          play: nativeImage.createFromPath(getControlsIconPath("play-button.png")),
          pause: nativeImage.createFromPath(getControlsIconPath("pause-button.png")),
          next: nativeImage.createFromPath(getControlsIconPath("play-next-button.png"))
        }
      : null;

  let progressInTaskbar = store.get("playback").progressInTaskbar;
  const updater = createTaskbarUpdater({ icons, sendRemoteCommand, progressEnabled: () => progressInTaskbar });

  updater.update(getMainWindow(), playerStateStore.getState());
  playerStateStore.addEventListener(state => updater.update(getMainWindow(), state));

  store.onDidChange("playback", newValue => {
    const enabled = newValue?.progressInTaskbar === true;
    if (enabled === progressInTaskbar) return;
    progressInTaskbar = enabled;
    if (!enabled) updater.clearProgress();
    else updater.update(getMainWindow(), playerStateStore.getState());
  });
}
