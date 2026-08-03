(function () {
  const state = window.__ytmdLoudnessNormalization;
  if (!state) return;

  const config = document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerResponse?.()?.playerConfig;
  const loudnessDb = config?.audioConfig?.loudnessDb;

  // Same formula as ~shared/loudness gainFromLoudnessDb: attenuate only.
  let gain = 1;
  if (typeof loudnessDb === "number" && isFinite(loudnessDb) && loudnessDb > 0) {
    gain = Math.pow(10, -loudnessDb / 20);
  }
  // A short ramp avoids the click a hard gain step would produce.
  state.gain.gain.setTargetAtTime(gain, state.context.currentTime, 0.05);
})();
