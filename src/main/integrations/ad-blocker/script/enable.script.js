// Second layer behind the player response prune. Pruning adSlots only works
// while the ad is still described in the JSON the page parses; server side ad
// insertion stitches the ad into the same stream as the music and leaves nothing
// to prune. YouTube Music still raises adPlaying in its own store either way, so
// this rides that flag: mute the element and run it fast enough that the break
// passes in about a second, and take the skip control as soon as it appears.

(function () {
  const AD_RATE = 16;
  const POLL_MS = 250;
  const SKIP_SELECTORS = [".ytp-ad-skip-button-modern", ".ytp-ad-skip-button", ".ytp-skip-ad-button"];

  if (window.__ytmdAdSkip) return "";

  const hook = window.__YTMD_HOOK__;
  if (!hook) return "";

  const state = {
    adPlaying: false,
    muted: null,
    rate: null,
    timer: null,
    skipReported: false,
    unsubscribe: null
  };
  window.__ytmdAdSkip = state;

  function report(kind, detail) {
    if (window.ytmd && window.ytmd.sendAdBlockEvent) window.ytmd.sendAdBlockEvent(kind, detail);
  }

  // Never seek. YouTube Music plays consecutive tracks on one MediaSource, so
  // video.currentTime and video.duration span every track appended so far and
  // seeking off either one lands in the music. Playback rate carries no timeline.
  function applyAdPlayback() {
    const video = document.querySelector("video");
    if (!video) return;

    if (state.muted === null) {
      state.muted = video.muted;
      state.rate = video.playbackRate;
    }

    // Runs on every tick rather than once: the element may not exist yet when
    // the break begins.
    if (!video.muted) video.muted = true;
    if (video.playbackRate !== AD_RATE) video.playbackRate = AD_RATE;
  }

  function clickSkip() {
    for (const selector of SKIP_SELECTORS) {
      const button = document.querySelector(selector);
      if (!button || button.disabled || button.getBoundingClientRect().width === 0) continue;

      button.click();
      // A break can need more than one click, so only the first is reported.
      if (!state.skipReported) {
        state.skipReported = true;
        report("skipped", selector);
      }
      return;
    }
  }

  function startAd() {
    state.skipReported = false;
    applyAdPlayback();
    if (state.timer === null) {
      state.timer = setInterval(() => {
        applyAdPlayback();
        clickSkip();
      }, POLL_MS);
    }
    report("adPlaying", null);
  }

  function endAd() {
    if (state.timer !== null) {
      clearInterval(state.timer);
      state.timer = null;
    }

    const video = document.querySelector("video");
    if (video && state.muted !== null) {
      video.muted = state.muted;
      video.playbackRate = state.rate;
    }

    state.muted = null;
    state.rate = null;
  }
  state.endAd = endAd;

  function onStoreChange() {
    const player = hook.ytmStore.getState().player;
    const adPlaying = !!player && player.adPlaying === true;
    if (adPlaying === state.adPlaying) return;

    state.adPlaying = adPlaying;
    if (adPlaying) startAd();
    else endAd();
  }

  state.unsubscribe = hook.ytmStore.subscribe(onStoreChange);
  onStoreChange();
  return "";
})
