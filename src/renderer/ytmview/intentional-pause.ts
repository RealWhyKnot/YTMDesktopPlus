export function installIntentionalPause(): void {
  type PlayerApi = { pauseVideo: () => void };
  const pauseWindow = window as typeof window & {
    __ytmdNonStopAllowPause?: boolean;
    __ytmdPause?: (playerApi: PlayerApi) => void;
  };

  if (pauseWindow.__ytmdPause) return;

  const pause = (playerApi: PlayerApi) => {
    pauseWindow.__ytmdNonStopAllowPause = true;
    playerApi.pauseVideo();
  };
  Object.defineProperty(pauseWindow, "__ytmdPause", { value: pause, configurable: false, enumerable: false, writable: false });
}
