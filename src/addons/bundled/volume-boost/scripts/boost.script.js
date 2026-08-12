// Extends YouTube Music's volume slider past its maximum and makes up the
// difference with a gain node.
//
// Below 100 nothing happens: YouTube Music maps the slider through its own
// perceptual curve and that curve reads the raw slider value, not a fraction of
// the maximum, so widening the track leaves the normal range untouched. At 100
// its volume saturates and the media element is already at full, which is where
// the gain takes over.

(function (options) {
  const ceiling = Math.min(1000, Math.max(110, Math.round(Number(options && options.ceiling)) || 200));
  const wantsLimiter = !(options && options.limiter === false);
  const STORAGE_KEY = "ytmd-volume-boost-level";
  const SLIDERS = "ytmusic-player-bar #volume-slider";

  const graph = window.__ytmdEnsureAudioGraph && window.__ytmdEnsureAudioGraph();
  if (!graph) return false;

  let state = window.__ytmdVolumeBoost;
  if (!state) {
    const boost = graph.context.createGain();
    // Threshold just under unity with a hard ratio: boosted peaks are held down
    // instead of clipping, which is the whole reason this is safe above 1.
    const limiter = graph.context.createDynamicsCompressor();
    limiter.threshold.value = -1;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    state = { boost: boost, limiter: limiter, limiterWired: null, level: 100 };
    window.__ytmdVolumeBoost = state;
  }

  // Everything here hangs off `out`, which nothing else ever disconnects, so a
  // room starting or stopping cannot tear the boost out of the chain.
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

  const clampLevel = value => Math.min(ceiling, Math.max(0, Math.round(Number(value) || 0)));

  const applyGain = level => {
    const gain = level > 100 ? level / 100 : 1;
    state.boost.gain.setTargetAtTime(gain, graph.context.currentTime, 0.01);
  };

  const paint = (slider, level) => {
    if (level > 100) {
      // The fill is one element scaled by level/ceiling, so inside its own box
      // the 100 mark sits at 100/level.
      slider.style.setProperty("--ytmd-boost-split", (10000 / level).toFixed(2) + "%");
      slider.classList.add("ytmd-boosted");
    } else {
      slider.style.removeProperty("--ytmd-boost-split");
      slider.classList.remove("ytmd-boosted");
    }
  };

  // Above 100 the element has to be at full for the gain to mean anything. A
  // drag through 100 saturates it anyway; this covers restoring a stored level.
  const saturateYtmVolume = () => {
    const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    if (!bar || !bar.playerApi) return;
    if (bar.playerApi.getVolume() >= 100) return;
    bar.playerApi.setVolume(100);
    const hook = window.__YTMD_HOOK__;
    if (hook && hook.ytmStore) hook.ytmStore.dispatch({ type: "SET_VOLUME", payload: 100 });
  };

  const setLevel = (level, fromUser) => {
    state.level = level;
    applyGain(level);
    if (level > 100) saturateYtmVolume();
    if (fromUser) {
      try {
        window.localStorage.setItem(STORAGE_KEY, String(level));
      } catch {
        // Private mode or a full quota; the level just will not survive a reload.
      }
    }
  };

  const setup = slider => {
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

  // YouTube Music can restamp the player bar. Rebinding when someone reaches for
  // it costs nothing and avoids watching the whole document for mutations.
  if (!window.__ytmdVolumeBoostDelegated) {
    window.__ytmdVolumeBoostDelegated = true;
    document.addEventListener("pointerdown", setupAll, true);
  }

  let stored;
  try {
    stored = parseInt(window.localStorage.getItem(STORAGE_KEY), 10);
  } catch {
    stored = NaN;
  }
  const restored = Number.isFinite(stored) ? clampLevel(stored) : clampLevel(state.level);
  if (restored > 100) {
    document.querySelectorAll(SLIDERS).forEach(slider => {
      slider.value = restored;
      slider.immediateValue = restored;
      paint(slider, restored);
    });
  }
  setLevel(restored, false);

  return true;
});
