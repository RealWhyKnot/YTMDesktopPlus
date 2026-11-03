export function runScript() {
  const pageWindow: Window & AdSkipWindow = window;
  const adRate = 16;
  const pollMs = 250;
  const skipSelectors = [".ytp-ad-skip-button-modern", ".ytp-ad-skip-button", ".ytp-skip-ad-button"];

  if (pageWindow.__ytmdAdSkip) return "";

  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  function isStore(value: unknown): value is { getState(): unknown; subscribe(callback: () => void): unknown } {
    return isRecord(value) && typeof value.getState === "function" && typeof value.subscribe === "function";
  }
  const hook: unknown = Reflect.get(window, "__YTMD_HOOK__");
  if (!isRecord(hook) || !isStore(hook.ytmStore)) return "";
  const store = hook.ytmStore;

  const state: AdSkipState = {
    adPlaying: false,
    muted: null,
    rate: null,
    timer: null,
    skipReported: false,
    unsubscribe: null,
  };
  pageWindow.__ytmdAdSkip = state;

  function report(kind: string, detail: unknown) {
    const bridge: unknown = Reflect.get(window, "ytmd");
    if (isRecord(bridge) && typeof bridge.sendAdBlockEvent === "function") Reflect.apply(bridge.sendAdBlockEvent, bridge, [kind, detail]);
  }

  function applyAdPlayback() {
    const video = document.querySelector("video");
    if (!video) return;

    if (state.muted === null) {
      state.muted = video.muted;
      state.rate = video.playbackRate;
    }

    if (!video.muted) video.muted = true;
    if (video.playbackRate !== adRate) video.playbackRate = adRate;
  }

  function clickSkip() {
    for (const selector of skipSelectors) {
      const button = document.querySelector(selector);
      if (
        !button ||
        ("disabled" in button && button.disabled) ||
        button.getBoundingClientRect().width === 0 ||
        !("click" in button) ||
        typeof button.click !== "function"
      )
        continue;

      Reflect.apply(button.click, button, []);

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
    state.timer ??= setInterval(() => {
      applyAdPlayback();
      clickSkip();
    }, pollMs);
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
      if (state.rate !== null) video.playbackRate = state.rate;
    }

    state.muted = null;
    state.rate = null;
  }
  state.endAd = endAd;

  function onStoreChange() {
    const snapshot = store.getState();
    const player = isRecord(snapshot) ? snapshot.player : undefined;
    const isAdPlaying = isRecord(player) && player.adPlaying === true;
    if (isAdPlaying === state.adPlaying) return;

    state.adPlaying = isAdPlaying;
    if (isAdPlaying) startAd();
    else endAd();
  }

  state.unsubscribe = store.subscribe(onStoreChange);
  onStoreChange();
  return "";
}
