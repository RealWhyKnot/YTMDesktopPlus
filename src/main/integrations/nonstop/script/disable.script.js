(function () {
  const state = window.__ytmdNonStop;
  if (!state) return "";

  if (state.pauseTimer !== null) clearTimeout(state.pauseTimer);
  if (state.appObserver) state.appObserver.disconnect();
  if (state.startupObserver) state.startupObserver.disconnect();

  for (const name of state.interactionEvents) {
    document.removeEventListener(name, state.onInteraction, true);
  }
  document.removeEventListener("yt-popup-opened", state.onPopupOpened);

  // Deleting the own property hands pause back to HTMLMediaElement.prototype.
  if (state.video) delete state.video.pause;

  // Only the setter is restored. The pause handler we registered stays until YTM
  // replaces it on the next track, and it resolves the video at call time, so the
  // hardware pause key keeps working in the meantime.
  if (state.originalSetActionHandler && navigator.mediaSession) {
    navigator.mediaSession.setActionHandler = state.originalSetActionHandler;
  }

  delete window.__ytmdNonStop;
  delete window.__ytmdNonStopAllowPause;
  return "";
})
