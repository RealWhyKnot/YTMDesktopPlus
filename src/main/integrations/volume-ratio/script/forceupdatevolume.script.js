(function() {
  const playerApi = document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi;
  if (!playerApi) return;
  const volume = playerApi.getVolume();
  playerApi.setVolume(volume);
  window.__YTMD_HOOK__.ytmStore.dispatch({ type: "SET_VOLUME", payload: volume });
})
