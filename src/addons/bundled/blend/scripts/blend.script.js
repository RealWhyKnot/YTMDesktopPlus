(function (options) {
  const graph = window.__ytmdEnsureAudioGraph && window.__ytmdEnsureAudioGraph();
  if (!graph) return false;

  const SYNC_TOLERANCE_S = 0.15;
  const RAMP_TICK_MS = 50;
  const MIN_FADE_IN_S = 0.4;
  const TRIGGER_SLACK_S = 0.12;
  const RESOURCE_BUFFER_SIZE = 1000;

  let state = window.__ytmdBlend;
  if (!state) {
    state = {
      config: null,
      video: null,
      handlers: null,
      shadow: null,
      shadowVideoId: null,
      phase: "idle",
      pendingFadeIn: false,
      awaitingAdvance: false,
      lastVideoId: null,
      outLevel: 1,
      reported: {},
      ramp: null,
      watchdog: null,
      blends: 0
    };
    window.__ytmdBlend = state;
  }

  if (!state.resourceBufferHooked) {
    state.resourceBufferHooked = true;
    if (performance.setResourceTimingBufferSize) performance.setResourceTimingBufferSize(RESOURCE_BUFFER_SIZE);
    if (performance.addEventListener) performance.addEventListener("resourcetimingbufferfull", () => performance.clearResourceTimings());
  }

  state.config = {
    seconds: Math.min(12, Math.max(1, Number(options.seconds) || 5)),
    repeatOne: options.repeatOne === true,
    adPlaying: options.adPlaying === true,
    hasNext: options.hasNext !== false
  };

  const playerBar = () => document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const playerApi = () => {
    const bar = playerBar();
    return (bar && bar.playerApi) || null;
  };
  const currentVideoId = () => {
    const api = playerApi();
    const data = api && api.getVideoData && api.getVideoData();
    return (data && data.video_id) || null;
  };

  const trackClock = () => {
    const api = playerApi();
    if (!api || !api.getCurrentTime || !api.getPlayerResponse) return null;
    const positionS = api.getCurrentTime();
    const response = api.getPlayerResponse();
    const durationS = Number(response && response.videoDetails && response.videoDetails.lengthSeconds);
    if (!isFinite(positionS) || !isFinite(durationS) || durationS <= 0) return null;
    return { positionS, durationS };
  };

  const report = (event, detail) => {
    if (!window.ytmd || !window.ytmd.postAddonMessage) return;
    try {
      window.ytmd.postAddonMessage("blend", "diag", Object.assign({ event, videoId: state.lastVideoId, blends: state.blends }, detail));
    } catch {
      return;
    }
  };
  const reportOnce = (key, event, detail) => {
    if (state.reported[key]) return;
    state.reported[key] = true;
    report(event, detail);
  };

  const nativeVolume = video => {
    const descriptor = window.HTMLMediaElement_volume;
    return descriptor && descriptor.get ? descriptor.get.call(video) : video.volume;
  };
  const clampLevel = value => (isFinite(value) ? Math.min(1, Math.max(0, value)) : null);
  const captureLevel = () => {
    const capture = window.__ytmdAudioStream;
    if (!capture || capture.stopped || typeof capture.effectiveVolume !== "function") return null;
    try {
      return clampLevel(capture.effectiveVolume());
    } catch {
      return null;
    }
  };
  const earLevel = video => {
    if (video.muted) return 0;
    const captured = captureLevel();
    if (captured !== null) return captured;
    const level = clampLevel(nativeVolume(video));
    return level === null ? 1 : level;
  };

  const equalPower = (t, direction) => (direction === "out" ? Math.cos((t * Math.PI) / 2) : Math.sin((t * Math.PI) / 2));

  const segmentUrl = () => {
    const entries = performance.getEntriesByType("resource").filter(entry => /videoplayback/.test(entry.name) && /mime=audio/.test(entry.name));
    if (!entries.length) return null;
    const url = new URL(entries[entries.length - 1].name);
    for (const param of ["range", "rn", "rbuf", "ump", "srfvp", "alr"]) url.searchParams.delete(param);
    return url.toString();
  };

  const releaseShadow = () => {
    const shadow = state.shadow;
    state.shadow = null;
    state.shadowVideoId = null;
    if (!shadow) return;
    try {
      shadow.pause();
      shadow.removeAttribute("src");
      shadow.load();
    } catch {
      report("releaseFailed", {});
    }
  };

  const armShadow = (videoId, positionS) => {
    const url = segmentUrl();
    if (!url) {
      reportOnce("arm", "armFailed", { reason: "no audio segment url yet" });
      return;
    }
    releaseShadow();
    const shadow = new Audio();
    shadow.preload = "auto";
    shadow.volume = 0;
    shadow.src = url;
    shadow.addEventListener(
      "canplay",
      () => {
        if (state.shadow !== shadow) return;
        const clock = trackClock();
        shadow.currentTime = clock ? clock.positionS : positionS;
        if (state.video && !state.video.paused) shadow.play().catch(() => {});
        report("armed", { videoId });
      },
      { once: true }
    );
    shadow.addEventListener("error", () => {
      if (state.shadow !== shadow) return;
      report("armFailed", { videoId, reason: "media error " + (shadow.error ? shadow.error.code : "?") });
      state.shadow = null;
      state.shadowVideoId = null;
    });
    state.shadow = shadow;
    state.shadowVideoId = videoId;
  };

  const syncShadow = positionS => {
    const shadow = state.shadow;
    if (!shadow || shadow.readyState < 2) return;
    if (state.video.paused) {
      if (!shadow.paused) shadow.pause();
      return;
    }
    if (shadow.paused) shadow.play().catch(() => {});
    if (Math.abs(shadow.currentTime - positionS) > SYNC_TOLERANCE_S) shadow.currentTime = positionS;
  };

  const setOutGain = (value, timeConstant) => {
    const gain = graph.out.gain;
    gain.cancelScheduledValues(graph.context.currentTime);
    if (timeConstant) gain.setTargetAtTime(value, graph.context.currentTime, timeConstant);
    else gain.setValueAtTime(value, graph.context.currentTime);
    state.outLevel = value;
  };

  const stopRamp = () => {
    if (!state.ramp) return;
    clearInterval(state.ramp.timer);
    state.ramp = null;
  };

  const clearWatchdog = () => {
    if (!state.watchdog) return;
    clearTimeout(state.watchdog);
    state.watchdog = null;
  };
  const armWatchdog = () => {
    clearWatchdog();
    state.watchdog = setTimeout(
      () => {
        state.watchdog = null;
        if (!state.pendingFadeIn && state.outLevel === 1) return;
        stopRamp();
        releaseShadow();
        state.phase = "idle";
        state.pendingFadeIn = false;
        state.awaitingAdvance = false;
        graph.out.gain.cancelScheduledValues(graph.context.currentTime);
        graph.out.gain.value = 1;
        state.outLevel = 1;
        report("silenceRecovered", { videoId: currentVideoId() });
      },
      (state.config.seconds * 2 + 8) * 1000
    );
  };

  const abort = reason => {
    stopRamp();
    clearWatchdog();
    releaseShadow();
    state.phase = "idle";
    state.pendingFadeIn = false;
    state.awaitingAdvance = false;
    if (state.outLevel !== 1) setOutGain(1, 0.05);
    if (reason) report("aborted", { reason });
  };

  const beginFadeIn = () => {
    const remainingS = state.ramp ? state.ramp.endsAt - performance.now() / 1000 : state.config.seconds;
    const fadeInS = Math.max(MIN_FADE_IN_S, remainingS);
    const gain = graph.out.gain;
    const now = graph.context.currentTime;
    const points = new Float32Array(33);
    for (let i = 0; i < points.length; i++) points[i] = equalPower(i / (points.length - 1), "in");
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);
    gain.setValueCurveAtTime(points, now, fadeInS);
    state.outLevel = 1;
    state.pendingFadeIn = false;
    state.awaitingAdvance = false;
    clearWatchdog();
  };

  const startBlend = (level, advance) => {
    const seconds = state.config.seconds;
    stopRamp();
    state.shadow.volume = level;
    const startedAt = performance.now() / 1000;
    state.ramp = {
      endsAt: startedAt + seconds,
      timer: setInterval(() => {
        const elapsed = performance.now() / 1000 - startedAt;
        if (elapsed >= seconds || !state.shadow) {
          stopRamp();
          releaseShadow();
          if (state.phase === "blending") state.phase = "idle";
          report("done", {});
          return;
        }
        state.shadow.volume = level * equalPower(elapsed / seconds, "out");
      }, RAMP_TICK_MS)
    };

    state.phase = "blending";
    state.pendingFadeIn = true;
    state.awaitingAdvance = advance;
    state.blends += 1;
    setOutGain(0, 0.02);
    armWatchdog();
    if (advance) {
      const api = playerApi();
      if (api && api.nextVideo) api.nextVideo();
    }
  };

  const shadowSounding = () => !!state.shadow && state.shadow.readyState >= 2 && !state.shadow.paused;

  const loadInProgress = () => {
    const api = playerApi();
    const playerState = api && api.getPlayerState ? api.getPlayerState() : null;
    return playerState === -1 || playerState === 3;
  };

  const gated = () => {
    if (state.config.adPlaying) return "ad playing";
    if (state.config.repeatOne) return "repeat one";
    return null;
  };
  const suppression = clock => gated() || (clock ? null : "no track clock");

  const onTrackChange = previous => {
    if (state.phase === "blending" || state.pendingFadeIn) {
      state.awaitingAdvance = false;
      if (!state.video.paused) beginFadeIn();
      return;
    }
    const ready = state.shadowVideoId === previous && shadowSounding();
    if (previous && ready && !gated()) {
      startBlend(earLevel(state.video), false);
      report("blend", { kind: "skip", seconds: state.config.seconds });
      return;
    }
    if (previous) report("cut", { reason: state.shadow ? "shadow not ready" : "no shadow armed" });
    releaseShadow();
  };

  const onTimeUpdate = () => {
    const video = state.video;
    if (!video) return;
    const clock = trackClock();
    const videoId = currentVideoId();

    if (videoId && videoId !== state.lastVideoId) {
      const previous = state.lastVideoId;
      state.lastVideoId = videoId;
      state.reported = {};
      onTrackChange(previous);
      return;
    }

    if (state.pendingFadeIn && !state.awaitingAdvance && !video.paused && video.readyState >= 3) beginFadeIn();

    const reason = suppression(clock);
    if (reason) {
      if (state.phase !== "idle" || state.outLevel !== 1) abort(reason);
      if (clock && clock.positionS > 5) reportOnce("suppressed", "suppressed", { reason });
      return;
    }
    if (state.phase !== "idle") return;

    if (state.shadowVideoId !== videoId) armShadow(videoId, clock.positionS);
    else syncShadow(clock.positionS);

    if (clock.positionS < clock.durationS - state.config.seconds - TRIGGER_SLACK_S) return;
    if (!state.config.hasNext) {
      reportOnce("suppressed", "suppressed", { reason: "no next track" });
      return;
    }
    if (!shadowSounding()) {
      reportOnce("suppressed", "suppressed", { reason: "shadow not ready" });
      return;
    }
    startBlend(earLevel(video), true);
    report("blend", { kind: "end", seconds: state.config.seconds });
  };

  const onPlaying = () => {
    if (state.pendingFadeIn) beginFadeIn();
  };

  const onPause = () => {
    if (state.phase !== "blending" && !state.pendingFadeIn) {
      if (state.shadow && !state.shadow.paused) state.shadow.pause();
      return;
    }
    if (loadInProgress()) return;
    abort("paused");
  };

  const onSeeking = () => {
    if (state.phase === "blending" && !loadInProgress()) abort("seeked");
  };

  const onVolumeChange = () => {
    if (state.phase === "blending" && state.shadow && state.video.muted) state.shadow.volume = 0;
  };

  const attach = () => {
    const video = document.querySelector("video");
    if (!video) return false;
    if (state.video === video && state.handlers) return true;
    detach();
    state.video = video;
    state.handlers = { onTimeUpdate, onPlaying, onPause, onSeeking, onVolumeChange };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("volumechange", onVolumeChange);
    state.lastVideoId = currentVideoId();
    return true;
  };

  function detach() {
    if (!state.video || !state.handlers) return;
    state.video.removeEventListener("timeupdate", state.handlers.onTimeUpdate);
    state.video.removeEventListener("playing", state.handlers.onPlaying);
    state.video.removeEventListener("pause", state.handlers.onPause);
    state.video.removeEventListener("seeking", state.handlers.onSeeking);
    state.video.removeEventListener("volumechange", state.handlers.onVolumeChange);
    state.video = null;
    state.handlers = null;
  }

  state.detachAll = () => {
    abort(null);
    detach();
    delete window.__ytmdBlend;
  };

  return attach();
});
