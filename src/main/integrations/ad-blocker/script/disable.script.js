(function () {
  const state = window.__ytmdAdSkip;
  if (!state) return "";

  if (typeof state.unsubscribe === "function") state.unsubscribe();
  // Restores mute and rate when the setting is turned off mid break.
  state.endAd();

  delete window.__ytmdAdSkip;
  return "";
})
