type BlendClock = { positionS: number; durationS: number };
type BlendConfig = { seconds: number; blendSkips: boolean; repeatOne: boolean; adPlaying: boolean; hasNext: boolean };
type BlendState = {
  config: BlendConfig | null;
  video: HTMLVideoElement | null;
  handlers: Record<"onTimeUpdate" | "onPlaying" | "onPause" | "onSeeking" | "onVolumeChange", () => void> | null;
  shadow: HTMLAudioElement | null;
  shadowVideoId: string | null;
  failedUrl: string | null;
  phase: "idle" | "blending";
  pendingFadeIn: boolean;
  awaitingAdvance: boolean;
  lastVideoId: string | null;
  outLevel: number;
  reported: Record<string, boolean>;
  ramp: { endsAt: number; timer: ReturnType<typeof setInterval> } | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  blends: number;
  resourceBufferHooked?: boolean;
  lastClock?: BlendClock | null;
  detachAll?: () => void;
};

type BlendPlayerApi = {
  getVideoData?: () => unknown;
  getCurrentTime?: () => unknown;
  getPlayerResponse?: () => unknown;
  nextVideo?: () => unknown;
  getPlayerState?: () => unknown;
};
