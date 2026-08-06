// Adapted from the YouTube NonStop extension:
// https://github.com/lawfx/YoutubeNonStop
// Made by: Charalampos Fanoulis <lawfx>
//
// The idea is upstream's: YouTube Music pauses on its own after a stretch of no
// interaction and then asks whether you are still there, so hold that pause back
// and dismiss the prompt. What differs here is the escape hatch. Every pause this
// app issues (media keys, tray, thumbbar, companion server, the follower sync,
// pause on launch) reaches the page as playerApi.pauseVideo(), which lands on the
// same video.pause() upstream swallows, and the user is idle by definition while
// music plays in the background. Those pauses set __ytmdNonStopAllowPause first
// and are let straight through.

(function () {
  const IDLE_MS = 5000;
  const PENDING_PAUSE_MS = 5000;
  const POPUP_NODE_NAME = "YTMUSIC-YOU-THERE-RENDERER";

  if (window.__ytmdNonStop) return "";

  // A pause command issued while this was switched off leaves the flag set.
  window.__ytmdNonStopAllowPause = false;

  const nativePause = HTMLMediaElement.prototype.pause;

  const state = {
    lastInteraction: Date.now(),
    pausePending: false,
    pauseTimer: null,
    video: null,
    originalSetActionHandler: null,
    appObserver: null,
    startupObserver: null
  };
  window.__ytmdNonStop = state;

  function isIdle() {
    return Date.now() - state.lastInteraction >= IDLE_MS;
  }

  function clearPendingPause() {
    state.pausePending = false;
    if (state.pauseTimer !== null) {
      clearTimeout(state.pauseTimer);
      state.pauseTimer = null;
    }
  }

  function currentVideo() {
    if (state.video && state.video.isConnected) return state.video;
    return document.querySelector("video");
  }

  // Resolved at call time so the media session handler left behind after the
  // setting is turned off keeps pausing the track that is actually playing.
  function pauseForReal() {
    clearPendingPause();
    const video = currentVideo();
    if (video) nativePause.call(video);
  }

  function holdPause() {
    state.pausePending = true;
    if (state.pauseTimer !== null) clearTimeout(state.pauseTimer);
    // A held pause that never turns out to be the inactivity pause is dropped
    // rather than carried forever.
    state.pauseTimer = setTimeout(clearPendingPause, PENDING_PAUSE_MS);
  }

  function onInteraction() {
    // A click on YTM's own pause button arrives as the interaction and the pause
    // together; whichever order they land in, the pause has to take effect.
    if (state.pausePending) {
      pauseForReal();
      return;
    }
    state.lastInteraction = Date.now();
  }
  state.onInteraction = onInteraction;

  function onPopupOpened(event) {
    if (!isIdle() || !event.detail || event.detail.nodeName !== POPUP_NODE_NAME) return;

    const container = document.querySelector("ytmusic-popup-container");
    if (container) container.click();

    clearPendingPause();
    const video = currentVideo();
    if (video && video.paused) video.play();
  }
  state.onPopupOpened = onPopupOpened;

  function keepPauseMediaKeyWorking() {
    const mediaSession = navigator.mediaSession;
    if (!mediaSession || state.originalSetActionHandler) return;

    const original = mediaSession.setActionHandler.bind(mediaSession);
    try {
      // Chromium routes the hardware pause key through the media session, where
      // YTM's own handler would call the pause we are holding back.
      original("pause", pauseForReal);
    } catch {
      return;
    }

    state.originalSetActionHandler = original;
    mediaSession.setActionHandler = (action, handler) => {
      if (action === "pause") return;
      original(action, handler);
    };
  }

  function overrideVideoPause() {
    if (state.video && state.video.isConnected) return;

    const video = document.querySelector("video");
    if (!video) return;

    state.video = video;
    if (Object.prototype.hasOwnProperty.call(video, "pause")) return;

    video.pause = function () {
      if (window.__ytmdNonStopAllowPause) {
        window.__ytmdNonStopAllowPause = false;
        pauseForReal();
        return;
      }

      if (!isIdle()) {
        pauseForReal();
        return;
      }

      holdPause();
    };

    keepPauseMediaKeyWorking();
  }

  function observeApp() {
    const app = document.querySelector("ytmusic-app");
    if (!app) return false;

    overrideVideoPause();
    state.appObserver = new MutationObserver(overrideVideoPause);
    state.appObserver.observe(app, { childList: true, subtree: true });
    return true;
  }

  const pointerEvent = window.PointerEvent ? "pointer" : "mouse";
  state.interactionEvents = [pointerEvent + "down", pointerEvent + "up", "keydown", "keyup"];
  for (const name of state.interactionEvents) {
    document.addEventListener(name, onInteraction, true);
  }
  document.addEventListener("yt-popup-opened", onPopupOpened);

  if (!observeApp()) {
    state.startupObserver = new MutationObserver(() => {
      if (!observeApp()) return;
      state.startupObserver.disconnect();
      state.startupObserver = null;
    });
    state.startupObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  return "";
})
