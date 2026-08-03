import { VideoState, type PlayerState } from "../player-state-store";

// Pause-on-launch without blocking autoplay.
//
// Blocking autoplay at the policy level made YouTube Music render its
// "Start playback" hint and silently swallowed every programmatic play, so
// instead the restore is allowed to start playing muted and gets paused the
// moment it reports as playing. The page mutes itself before dispatching the
// restore navigate; this arms on that signal and restores the mute state on
// every exit path except supersession, where the newer attempt owns it.
//
// Dependencies are injected so this stays free of Electron and testable.

export const LAUNCH_PAUSE_TIMEOUT_MS = 20000;

export interface LaunchPauseDeps {
  addEventListener(listener: (state: PlayerState) => void): void;
  removeEventListener(listener: (state: PlayerState) => void): void;
  send(command: "pause" | "unmute"): void;
}

export type LaunchPauseResult = "paused" | "timeout" | "superseded";

export function createLaunchPause(deps: LaunchPauseDeps) {
  let current: { settle: (result: LaunchPauseResult) => void } | null = null;

  function arm(videoId: string, wasMuted: boolean): Promise<LaunchPauseResult> {
    current?.settle("superseded");

    return new Promise<LaunchPauseResult>(resolve => {
      let settled = false;

      const listener = (state: PlayerState) => {
        if (state.trackState !== VideoState.Playing) return;
        if (!state.videoDetails || state.videoDetails.id !== videoId) return;
        deps.send("pause");
        entry.settle("paused");
      };

      const timeout = setTimeout(() => entry.settle("timeout"), LAUNCH_PAUSE_TIMEOUT_MS);

      const entry = {
        settle(result: LaunchPauseResult) {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          deps.removeEventListener(listener);
          if (current === entry) current = null;
          if (result !== "superseded" && !wasMuted) deps.send("unmute");
          resolve(result);
        }
      };

      current = entry;
      deps.addEventListener(listener);
    });
  }

  function cancel() {
    current?.settle("superseded");
  }

  return { arm, cancel };
}
