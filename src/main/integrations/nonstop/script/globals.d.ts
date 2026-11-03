type NonStopState = {
  lastInteraction: number;
  pausePending: boolean;
  pauseTimer: ReturnType<typeof setTimeout> | null;
  video: HTMLVideoElement | null;
  originalSetActionHandler: MediaSession["setActionHandler"] | null;
  appObserver: MutationObserver | null;
  startupObserver: MutationObserver | null;
  onInteraction?: () => void;
  onPopupOpened?: (event: Event) => void;
  interactionEvents?: string[];
};

type NonStopWindow = {
  __ytmdNonStop?: NonStopState;
  __ytmdNonStopAllowPause?: boolean;
};
