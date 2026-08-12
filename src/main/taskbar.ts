import { nativeImage } from "electron";
import type Conf from "conf";
import playerStateStore, { PlayerState, VideoState } from "./player-state-store";
import type { StoreSchema } from "../shared/store/schema";

export interface TaskbarDeps {
  store: Conf<StoreSchema>;
  getMainWindow(): Electron.BrowserWindow | null;
  sendRemoteCommand(command: string): void;
  getControlsIconPath(icon: string): string;
}

export function setupTaskbarFeatures(deps: TaskbarDeps): void {
  const { store, getMainWindow, sendRemoteCommand, getControlsIconPath } = deps;

  // Setup Taskbar Icons
  const bootWindow = getMainWindow();
  if (bootWindow && bootWindow.isVisible() && process.platform === "win32") {
    bootWindow.setThumbarButtons([
      {
        tooltip: "Previous",
        icon: nativeImage.createFromPath(getControlsIconPath("play-previous-button.png")),
        flags: ["disabled"],
        click() {
          sendRemoteCommand("previous");
        }
      },
      {
        tooltip: "Play/Pause",
        icon: nativeImage.createFromPath(getControlsIconPath("play-button.png")),
        flags: ["disabled"],
        click() {
          sendRemoteCommand("playPause");
        }
      },
      {
        tooltip: "Next",
        icon: nativeImage.createFromPath(getControlsIconPath("play-next-button.png")),
        flags: ["disabled"],
        click() {
          sendRemoteCommand("next");
        }
      }
    ]);
  }
  playerStateStore.addEventListener((state: PlayerState) => {
    const hasVideo = !!state.videoDetails;
    const isPlaying = state.trackState === VideoState.Playing;
    const mainWindow = getMainWindow();

    if (process.platform == "win32") {
      const taskbarFlags = [];
      if (!hasVideo) {
        taskbarFlags.push("disabled");
      }

      if (mainWindow && mainWindow.isVisible()) {
        mainWindow.setThumbarButtons([
          {
            tooltip: "Previous",
            icon: nativeImage.createFromPath(getControlsIconPath("play-previous-button.png")),
            flags: taskbarFlags,
            click() {
              sendRemoteCommand("previous");
            }
          },
          {
            tooltip: "Play/Pause",
            icon: isPlaying
              ? nativeImage.createFromPath(getControlsIconPath("pause-button.png"))
              : nativeImage.createFromPath(getControlsIconPath("play-button.png")),
            flags: taskbarFlags,
            click() {
              sendRemoteCommand("playPause");
            }
          },
          {
            tooltip: "Next",
            icon: nativeImage.createFromPath(getControlsIconPath("play-next-button.png")),
            flags: taskbarFlags,
            click() {
              sendRemoteCommand("next");
            }
          }
        ]);
      }
    }

    if (mainWindow && store.get("playback").progressInTaskbar) {
      mainWindow.setProgressBar(hasVideo ? state.videoProgress / state.videoDetails.durationSeconds : -1, {
        mode: isPlaying ? "normal" : "paused"
      });
    }
  });

  store.onDidChange("playback", (newValue, oldValue) => {
    const mainWindow = getMainWindow();
    if (mainWindow && newValue.progressInTaskbar !== oldValue.progressInTaskbar && !newValue.progressInTaskbar) {
      mainWindow.setProgressBar(-1);
    }
  });
}
