export function runScript() {
  const pageWindow: Window & NonStopWindow = window;
  const idleMs = 5000;
  const pendingPauseMs = 5000;
  const popupNodeName = "YTMUSIC-YOU-THERE-RENDERER";

  if (pageWindow.__ytmdNonStop) return "";

  pageWindow.__ytmdNonStopAllowPause = false;

  const mediaPrototype: { pause: (this: HTMLMediaElement) => void } = HTMLMediaElement.prototype;
  const nativePause = mediaPrototype.pause;

  const state: NonStopState = {
    lastInteraction: Date.now(),
    pausePending: false,
    pauseTimer: null,
    video: null,
    originalSetActionHandler: null,
    appObserver: null,
    startupObserver: null,
  };
  pageWindow.__ytmdNonStop = state;

  function isIdle() {
    return Date.now() - state.lastInteraction >= idleMs;
  }

  function clearPendingPause() {
    state.pausePending = false;
    if (state.pauseTimer !== null) {
      clearTimeout(state.pauseTimer);
      state.pauseTimer = null;
    }
  }

  function currentVideo() {
    if (state.video?.isConnected) return state.video;
    return document.querySelector("video");
  }

  function pauseForReal() {
    clearPendingPause();
    const video = currentVideo();
    if (video) nativePause.call(video);
  }

  function holdPause() {
    state.pausePending = true;
    if (state.pauseTimer !== null) clearTimeout(state.pauseTimer);

    state.pauseTimer = setTimeout(clearPendingPause, pendingPauseMs);
  }

  function onInteraction() {
    if (state.pausePending) {
      pauseForReal();
      return;
    }
    state.lastInteraction = Date.now();
  }
  state.onInteraction = onInteraction;

  function onPopupOpened(event: Event) {
    const detail: unknown = "detail" in event ? event.detail : undefined;
    if (!isIdle() || typeof detail !== "object" || detail === null || !("nodeName" in detail) || detail.nodeName !== popupNodeName) return;

    const container = document.querySelector("ytmusic-popup-container");
    if (container && "click" in container && typeof container.click === "function") Reflect.apply(container.click, container, []);

    clearPendingPause();
    const video = currentVideo();
    if (video?.paused) Promise.resolve(video.play()).catch((error: unknown) => console.warn("NonStop could not resume playback", error));
  }
  state.onPopupOpened = onPopupOpened;

  function keepPauseMediaKeyWorking() {
    const browserNavigator: { readonly mediaSession?: MediaSession } = navigator;
    const mediaSession = browserNavigator.mediaSession;
    if (!mediaSession || state.originalSetActionHandler) return;

    const original = mediaSession.setActionHandler.bind(mediaSession);
    try {
      original("pause", pauseForReal);
    } catch (error: unknown) {
      console.warn("NonStop could not register the pause key", error);
      return;
    }

    state.originalSetActionHandler = original;
    mediaSession.setActionHandler = (action, handler) => {
      if (action === "pause") return;
      original(action, handler);
    };
  }

  function overrideVideoPause() {
    if (state.video?.isConnected) return;

    const video = document.querySelector("video");
    if (!video) return;

    state.video = video;
    if (Object.prototype.hasOwnProperty.call(video, "pause")) return;

    video.pause = function () {
      if (pageWindow.__ytmdNonStopAllowPause) {
        pageWindow.__ytmdNonStopAllowPause = false;
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

  const pointerEventType: unknown = Reflect.get(window, "PointerEvent");
  const pointerEvent = pointerEventType ? "pointer" : "mouse";
  state.interactionEvents = [pointerEvent + "down", pointerEvent + "up", "keydown", "keyup"];
  for (const name of state.interactionEvents) {
    document.addEventListener(name, onInteraction, true);
  }
  document.addEventListener("yt-popup-opened", onPopupOpened);

  if (!observeApp()) {
    state.startupObserver = new MutationObserver(() => {
      if (!observeApp()) return;
      state.startupObserver?.disconnect();
      state.startupObserver = null;
    });
    state.startupObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  return "";
}
