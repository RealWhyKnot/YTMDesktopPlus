// Tears the crossfade engine down: stops any shadow tail, restores the graph
// gain and drops the element listeners.
(function () {
  const state = window.__ytmdDjCrossfade;
  if (state && state.detachAll) state.detachAll();
  return true;
});
