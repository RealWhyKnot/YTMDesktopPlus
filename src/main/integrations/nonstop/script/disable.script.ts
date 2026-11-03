export function runScript() {
  const pageWindow: Window & NonStopWindow = window;
  const state = pageWindow.__ytmdNonStop;
  if (!state) return "";

  if (state.pauseTimer !== null) clearTimeout(state.pauseTimer);
  if (state.appObserver) state.appObserver.disconnect();
  if (state.startupObserver) state.startupObserver.disconnect();

  for (const name of state.interactionEvents ?? []) {
    if (state.onInteraction) document.removeEventListener(name, state.onInteraction, true);
  }
  if (state.onPopupOpened) document.removeEventListener("yt-popup-opened", state.onPopupOpened);

  if (state.video) Reflect.deleteProperty(state.video, "pause");

  const browserNavigator: { readonly mediaSession?: MediaSession } = navigator;
  if (state.originalSetActionHandler && browserNavigator.mediaSession) {
    browserNavigator.mediaSession.setActionHandler = state.originalSetActionHandler;
  }

  delete pageWindow.__ytmdNonStop;
  delete pageWindow.__ytmdNonStopAllowPause;
  return "";
}
