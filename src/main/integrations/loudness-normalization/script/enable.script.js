(function () {
  const video = document.querySelector("video");
  if (!video) return;

  // createMediaElementSource permanently reroutes the element, so the graph is
  // installed once and kept; disabling just sets the gain back to 1.
  let state = window.__ytmdLoudnessNormalization;
  if (!state) {
    const context = new AudioContext();
    const source = context.createMediaElementSource(video);
    const gain = context.createGain();
    source.connect(gain);
    gain.connect(context.destination);
    state = { context, gain };
    window.__ytmdLoudnessNormalization = state;
  }
  if (state.context.state === "suspended") {
    state.context.resume();
  }
});
