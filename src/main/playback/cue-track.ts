import { VideoState, type PlayerState } from "../player-state-store";
import { resolveStartSeconds } from "~shared/protocol-url";
import type { CueRequest, CueResult } from "~shared/addons/sdk";

// Opens a track and lands it at a given position.
//
// Navigation is a fire-and-forget DOM event on the YouTube Music page with no
// acknowledgement, and the page loads asynchronously, so a seek issued on a
// timer either does nothing or moves the track that is still on screen. The
// only reliable signal is our own player state reporting the target video, so
// every stage here waits on that instead of guessing.
//
// Dependencies are injected so this stays free of Electron and testable.

export const LOAD_TIMEOUT_MS = 20000;
// YouTube Music issues its own seek to the start just after a track loads.
// Seeking into that window loses the position.
export const SETTLE_MS = 300;
export const VERIFY_MS = 2500;
export const VERIFY_TOLERANCE_SECONDS = 4;
export const MAX_SEEK_RETRIES = 1;

export type { CueRequest, CueResult } from "~shared/addons/sdk";

export interface CueDeps {
  getState(): PlayerState | null;
  addEventListener(listener: (state: PlayerState) => void): void;
  removeEventListener(listener: (state: PlayerState) => void): void;
  // Returns false when there is no view to drive.
  send(command: string, value?: unknown): boolean;
  now(): number;
}

type Stage = {
  generation: number;
  listener: ((state: PlayerState) => void) | null;
  timer: ReturnType<typeof setTimeout> | null;
  resolve: (result: CueResult) => void;
};

export function createTrackCue(deps: CueDeps) {
  let generation = 0;
  let stage: Stage | null = null;

  function detach() {
    if (!stage) return;
    if (stage.listener) deps.removeEventListener(stage.listener);
    if (stage.timer) clearTimeout(stage.timer);
    stage.listener = null;
    stage.timer = null;
  }

  function finish(result: CueResult) {
    if (!stage) return;
    const settled = stage;
    detach();
    stage = null;
    settled.resolve(result);
  }

  // A load that never completes stops emitting state entirely, so the deadline
  // has to be a timer rather than a check inside the listener.
  function watch(onState: (state: PlayerState) => void, timeoutMs: number, onTimeout: () => void) {
    if (!stage) return;
    detach();
    const listener = (state: PlayerState) => {
      if (!stage || stage.generation !== generation) {
        finish("superseded");
        return;
      }
      onState(state);
    };
    stage.listener = listener;
    stage.timer = setTimeout(onTimeout, timeoutMs);
    deps.addEventListener(listener);
  }

  function isLoaded(state: PlayerState | null, videoId: string) {
    const details = state?.videoDetails;
    if (!details || details.id !== videoId) return false;
    if (!state.hasFullMetadata || state.adPlaying) return false;
    if (!Number.isFinite(details.durationSeconds) || details.durationSeconds <= 0) return false;
    return state.trackState === VideoState.Playing || state.trackState === VideoState.Paused;
  }

  // Recomputed at every seek: navigation takes seconds, and a live anchor has
  // moved on by the time the track is ready.
  function targetFor(request: CueRequest, state: PlayerState) {
    return resolveStartSeconds(request.anchor, deps.now(), state.videoDetails.durationSeconds);
  }

  function verify(request: CueRequest, target: number, attempt: number) {
    watch(
      state => {
        if (state.videoDetails?.id !== request.videoId) {
          finish("superseded");
          return;
        }
        if (Math.abs(state.videoProgress - target) <= VERIFY_TOLERANCE_SECONDS) finish("seeked");
      },
      VERIFY_MS,
      () => {
        const state = deps.getState();
        if (attempt < MAX_SEEK_RETRIES && isLoaded(state, request.videoId)) {
          const retarget = targetFor(request, state);
          if (retarget !== null && deps.send("seekTo", retarget)) {
            verify(request, retarget, attempt + 1);
            return;
          }
        }
        // A paused track reports no progress, so there is nothing left to
        // confirm the seek with.
        finish(state?.trackState === VideoState.Paused ? "seeked" : "timeout");
      }
    );
  }

  function seekThenVerify(request: CueRequest, state: PlayerState, whenAtStart: CueResult) {
    const target = targetFor(request, state);
    if (target === null) {
      finish(whenAtStart);
      return;
    }
    if (!deps.send("seekTo", target)) {
      finish("no-view");
      return;
    }
    verify(request, target, 0);
  }

  function settleThenSeek(request: CueRequest) {
    if (!stage) return;
    detach();
    stage.timer = setTimeout(() => {
      if (!stage || stage.generation !== generation) {
        finish("superseded");
        return;
      }
      const state = deps.getState();
      if (!isLoaded(state, request.videoId)) {
        finish("timeout");
        return;
      }
      seekThenVerify(request, state, "navigated");
    }, SETTLE_MS);
  }

  function awaitLoad(request: CueRequest) {
    watch(
      state => {
        if (isLoaded(state, request.videoId)) settleThenSeek(request);
      },
      LOAD_TIMEOUT_MS,
      () => finish("timeout")
    );
  }

  return {
    cue(request: CueRequest): Promise<CueResult> {
      finish("superseded");
      const mine = ++generation;

      return new Promise<CueResult>(resolve => {
        stage = { generation: mine, listener: null, timer: null, resolve };

        const current = deps.getState();
        const onTargetVideo = current?.videoDetails?.id === request.videoId;

        if (isLoaded(current, request.videoId)) {
          seekThenVerify(request, current, "already-there");
          return;
        }

        // Renavigating a half-loaded target restarts the load and costs more
        // position than waiting for it does.
        if (!onTargetVideo) {
          const sent = deps.send("navigate", {
            watchEndpoint: { videoId: request.videoId, playlistId: request.playlistId ?? undefined }
          });
          if (!sent) {
            finish("no-view");
            return;
          }
        }

        if (request.anchor === null) {
          finish(onTargetVideo ? "already-there" : "navigated");
          return;
        }
        awaitLoad(request);
      });
    },

    cancel() {
      finish("superseded");
    }
  };
}
