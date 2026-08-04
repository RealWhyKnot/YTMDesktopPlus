(function () {
  const state = window.__ytmdLoudnessNormalization;
  if (!state) return;
  state.gain.gain.setTargetAtTime(1, state.context.currentTime, 0.05);
});
