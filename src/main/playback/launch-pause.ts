import { VideoState, type PlayerState } from "../player-state-store";

export const LAUNCH_PAUSE_TIMEOUT_MS = 20000;

export type LaunchPauseDeps = {
  addEventListener(listener: (state: PlayerState) => void): void;
  removeEventListener(listener: (state: PlayerState) => void): void;
  send(command: "pause" | "unmute"): void;
};

export type LaunchPauseResult = "paused" | "timeout" | "superseded";

let armedVideoId: string | null = null;

export function launchPauseArmedFor(): string | null {
  return armedVideoId;
}

export function createLaunchPause(deps: LaunchPauseDeps) {
  let current: { settle: (result: LaunchPauseResult) => void } | null = null;

  function arm(videoId: string, wasMuted: boolean): Promise<LaunchPauseResult> {
    current?.settle("superseded");

    return new Promise<LaunchPauseResult>((resolve) => {
      let isSettled = false;

      const listener = (state: PlayerState) => {
        if (state.trackState !== VideoState.Playing) return;
        if (state.videoDetails?.id !== videoId) return;
        deps.send("pause");
        entry.settle("paused");
      };

      const timeout = setTimeout(() => entry.settle("timeout"), LAUNCH_PAUSE_TIMEOUT_MS);

      const entry = {
        settle(result: LaunchPauseResult) {
          if (isSettled) return;
          isSettled = true;
          clearTimeout(timeout);
          deps.removeEventListener(listener);
          if (current === entry) {
            current = null;
            armedVideoId = null;
          }
          if (result !== "superseded" && !wasMuted) deps.send("unmute");
          resolve(result);
        },
      };

      current = entry;
      armedVideoId = videoId;
      deps.addEventListener(listener);
    });
  }

  function cancel() {
    current?.settle("superseded");
  }

  return { arm, cancel };
}
