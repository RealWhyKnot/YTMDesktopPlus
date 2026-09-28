interface Window {
  __fs?: unknown;
  __YTMD_HOOK__?: { ytmStore?: unknown };
  __ytmdAdPrune?: { enabled?: boolean; count?: number };
  __ytmdAdSkip?: unknown;
  __ytmdAudioGraph?: unknown;
  __ytmdNonStop?: unknown;
}

interface Element {
  __ytmdPlayerApiVia?: string;
  click?: () => void;
  currentTime?: number;
  getCurrentTime?: () => number;
  getPlayerState?: () => number;
  getVideoData?: () => { video_id?: string } | undefined;
  paused?: boolean;
  playbackRate?: number;
  playerApi?: Element;
  readyState?: number;
  resolvePlayerApi?: () => unknown;
}

interface HTMLMediaElement {
  __fsId?: number;
}

interface Event {
  playertype?: string;
}
