import { readDecimalIntegerPrefix } from "../../../../shared/integer-prefix";

export function runScript(options: unknown) {
  type BoostState = { boost: GainNode; limiter: DynamicsCompressorNode; limiterWired: boolean | null; level: number };
  type Slider = HTMLElement & { max?: unknown; value?: unknown; immediateValue?: unknown; __ytmdBoostBound?: boolean };
  const pageWindow: Window & RoomCaptureWindow & { __ytmdVolumeBoost?: BoostState; __ytmdVolumeBoostDelegated?: boolean } = window;
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  function isPlayerApi(value: unknown): value is { getVolume(): unknown; setVolume(volume: number): unknown } {
    return isRecord(value) && typeof value.getVolume === "function" && typeof value.setVolume === "function";
  }
  function isStore(value: unknown): value is { dispatch(action: { type: string; payload: number }): unknown } {
    return isRecord(value) && typeof value.dispatch === "function";
  }
  const ceiling = Math.min(1000, Math.max(110, Math.round(Number(isRecord(options) && options.ceiling)) || 200));
  const wantsLimiter = !(isRecord(options) && options.limiter === false);
  const storageKey = "ytmd-volume-boost-level";
  const SLIDERS = "ytmusic-player-bar #volume-slider";

  const graph = pageWindow.__ytmdEnsureAudioGraph?.();
  if (!graph) return false;

  let sharedState = pageWindow.__ytmdVolumeBoost;
  if (!sharedState) {
    const boost = graph.context.createGain();

    const limiter = graph.context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    sharedState = { boost: boost, limiter: limiter, limiterWired: null, level: 100 };
    pageWindow.__ytmdVolumeBoost = sharedState;
  }
  const state = sharedState;

  if (state.limiterWired !== wantsLimiter) {
    graph.out.disconnect();
    state.boost.disconnect();
    state.limiter.disconnect();
    graph.out.connect(state.boost);
    if (wantsLimiter) {
      state.boost.connect(state.limiter);
      state.limiter.connect(graph.context.destination);
    } else {
      state.boost.connect(graph.context.destination);
    }
    state.limiterWired = wantsLimiter;
  }

  const clampLevel = (value: unknown) => Math.min(ceiling, Math.max(0, Math.round(Number(value) || 0)));

  const applyGain = (level: number) => {
    const gain = level > 100 ? level / 100 : 1;
    state.boost.gain.setTargetAtTime(gain, graph.context.currentTime, 0.01);
  };

  const paint = (slider: Slider, level: number) => {
    if (level > 100) {
      slider.style.setProperty("--ytmd-boost-split", (10000 / level).toFixed(2) + "%");
      slider.classList.add("ytmd-boosted");
    } else {
      slider.style.removeProperty("--ytmd-boost-split");
      slider.classList.remove("ytmd-boosted");
    }
  };

  const saturateYtmVolume = () => {
    const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    const api = bar && "playerApi" in bar ? bar.playerApi : undefined;
    if (!isPlayerApi(api)) return;
    const volume = api.getVolume();
    if (typeof volume === "number" && volume >= 100) return;
    api.setVolume(100);
    const hook: unknown = Reflect.get(window, "__YTMD_HOOK__");
    if (isRecord(hook) && isStore(hook.ytmStore)) hook.ytmStore.dispatch({ type: "SET_VOLUME", payload: 100 });
  };

  const setLevel = (level: number, isFromUser: boolean) => {
    state.level = level;
    applyGain(level);
    if (level > 100) saturateYtmVolume();
    if (isFromUser) {
      try {
        window.localStorage.setItem(storageKey, String(level));
      } catch (error) {
        console.warn("boost.script: operation failed", error);
      }
    }
  };

  const setup = (element: Element) => {
    if (!(element instanceof HTMLElement)) return;
    const slider: Slider = element;
    if (slider.max !== ceiling) slider.max = ceiling;
    if (!slider.__ytmdBoostBound) {
      slider.__ytmdBoostBound = true;
      const onChange = () => {
        const level = clampLevel(slider.immediateValue);
        paint(slider, level);
        setLevel(level, true);
      };
      slider.addEventListener("immediate-value-changed", onChange);
      slider.addEventListener("value-changed", onChange);
    }
    paint(slider, clampLevel(slider.value));
  };

  const setupAll = () => document.querySelectorAll(SLIDERS).forEach(setup);
  setupAll();

  if (!pageWindow.__ytmdVolumeBoostDelegated) {
    pageWindow.__ytmdVolumeBoostDelegated = true;
    document.addEventListener("pointerdown", setupAll, true);
  }

  let stored;
  try {
    stored = readDecimalIntegerPrefix(window.localStorage.getItem(storageKey) ?? "");
  } catch (error: unknown) {
    console.warn("Volume boost could not read its saved level", error);
    stored = NaN;
  }
  const restored = Number.isFinite(stored) ? clampLevel(stored) : clampLevel(state.level);
  if (restored > 100) {
    document.querySelectorAll(SLIDERS).forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const slider: Slider = element;
      slider.value = restored;
      slider.immediateValue = restored;
      paint(slider, restored);
    });
  }
  setLevel(restored, false);

  return true;
}
