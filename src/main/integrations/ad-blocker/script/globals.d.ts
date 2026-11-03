type AdSkipState = {
  adPlaying: boolean;
  muted: boolean | null;
  rate: number | null;
  timer: ReturnType<typeof setInterval> | null;
  skipReported: boolean;
  unsubscribe: unknown;
  endAd?: () => void;
};

type AdSkipWindow = {
  __ytmdAdSkip?: AdSkipState;
};
