export function runScript(options: unknown) {
  const pageWindow: Omit<Window, "ytmd"> &
    RoomCaptureWindow & {
      __ytmdBlend?: BlendState;
      ytmd?: { postAddonMessage?: (addonId: string, name: string, payload: unknown) => unknown };
    } = window;
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  function isPlayerApi(value: unknown): value is BlendPlayerApi {
    return (
      isRecord(value) &&
      ["getVideoData", "getCurrentTime", "getPlayerResponse", "nextVideo", "getPlayerState"].every(
        (key) => value[key] === undefined || typeof value[key] === "function"
      )
    );
  }
  if (!isRecord(options)) return false;
  const graph = pageWindow.__ytmdEnsureAudioGraph?.();
  if (!graph) return false;

  const syncToleranceS = 0.15;
  const rampTickMs = 50;
  const minFadeInS = 0.4;
  const triggerSlackS = 0.12;
  const resourceBufferSize = 1000;
  const durationMatchS = 1.5;

  let sharedState = pageWindow.__ytmdBlend;
  if (!sharedState) {
    sharedState = {
      config: null,
      video: null,
      handlers: null,
      shadow: null,
      shadowVideoId: null,
      failedUrl: null,
      phase: "idle",
      pendingFadeIn: false,
      awaitingAdvance: false,
      lastVideoId: null,
      outLevel: 1,
      reported: {},
      ramp: null,
      watchdog: null,
      blends: 0,
    };
    pageWindow.__ytmdBlend = sharedState;
  }
  const state = sharedState;
  const configuration = () => {
    if (state.config === null) throw new Error("Blend configuration is missing");
    return state.config;
  };

  const pagePerformance: Partial<Pick<Performance, "setResourceTimingBufferSize" | "addEventListener">> & Pick<Performance, "clearResourceTimings"> =
    performance;
  if (!state.resourceBufferHooked) {
    state.resourceBufferHooked = true;
    if (pagePerformance.setResourceTimingBufferSize) pagePerformance.setResourceTimingBufferSize(resourceBufferSize);
    if (pagePerformance.addEventListener) pagePerformance.addEventListener("resourcetimingbufferfull", () => pagePerformance.clearResourceTimings());
  }

  state.config = {
    seconds: Math.min(12, Math.max(1, Number(options.seconds) || 5)),
    blendSkips: options.blendSkips === true,
    repeatOne: options.repeatOne === true,
    adPlaying: options.adPlaying === true,
    hasNext: options.hasNext !== false,
  };

  let bar: Element | null = null;
  const playerBar = () => {
    if (!bar?.isConnected) bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    return bar;
  };
  const playerApi = () => {
    const bar = playerBar();
    const api = bar && "playerApi" in bar ? bar.playerApi : undefined;
    return isPlayerApi(api) ? api : null;
  };
  const currentVideoId = () => {
    const api = playerApi();
    const data = api?.getVideoData?.();
    return isRecord(data) && typeof data.video_id === "string" ? data.video_id || null : null;
  };

  const trackClock = () => {
    const api = playerApi();
    if (!api?.getCurrentTime || !api.getPlayerResponse) return null;
    const positionS = api.getCurrentTime();
    const rawResponse = api.getPlayerResponse();
    const response = isRecord(rawResponse) ? rawResponse : undefined;
    const details = response?.videoDetails;
    const durationS = Number(isRecord(details) ? details.lengthSeconds : undefined);
    if (typeof positionS !== "number" || !Number.isFinite(positionS) || !Number.isFinite(durationS) || durationS <= 0) return null;
    return { positionS, durationS };
  };

  const report = (event: string, detail: Record<string, unknown>) => {
    if (!pageWindow.ytmd?.postAddonMessage) return;
    try {
      pageWindow.ytmd.postAddonMessage("blend", "diag", Object.assign({ event, videoId: state.lastVideoId, blends: state.blends }, detail));
    } catch (error: unknown) {
      console.warn("Blend could not report playback status", error);
      return;
    }
  };
  const reportOnce = (key: string, event: string, detail: Record<string, unknown>) => {
    if (state.reported[key]) return;
    state.reported[key] = true;
    report(event, detail);
  };

  const nativeVolume = (video: HTMLVideoElement): unknown => {
    const descriptor = pageWindow.HTMLMediaElement_volume;
    return descriptor?.get ? descriptor.get.call(video) : video.volume;
  };
  const clampLevel = (value: unknown) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : null;
  };
  const captureLevel = () => {
    const capture = pageWindow.__ytmdAudioStream;
    if (!capture || capture.stopped || typeof capture.effectiveVolume !== "function") return null;
    try {
      return clampLevel(capture.effectiveVolume());
    } catch (error: unknown) {
      console.warn("Blend could not read the capture volume", error);
      return null;
    }
  };
  const earLevel = (video: HTMLVideoElement) => {
    if (video.muted) return 0;
    const captured = captureLevel();
    if (captured !== null) return captured;
    const level = clampLevel(nativeVolume(video));
    return level ?? 1;
  };

  const equalPower = (t: number, direction: "in" | "out") => (direction === "out" ? Math.cos((t * Math.PI) / 2) : Math.sin((t * Math.PI) / 2));

  const segmentUrl = (durationS: number) => {
    const urls = performance
      .getEntriesByType("resource")
      .filter((entry) => entry.name.includes("videoplayback") && entry.name.includes("mime=audio"))
      .map((entry) => new URL(entry.name));
    const dated = urls.filter((url) => url.searchParams.has("dur"));
    const url = dated.length
      ? dated.findLast((candidate) => Math.abs(Number(candidate.searchParams.get("dur")) - durationS) < durationMatchS)
      : urls[urls.length - 1];
    if (!url) return null;
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

  const armShadow = (videoId: string | null, clock: BlendClock) => {
    const url = segmentUrl(clock.durationS);
    if (!url) {
      reportOnce("arm", "armFailed", { reason: "no audio segment url yet" });
      return;
    }
    if (url === state.failedUrl) return;
    releaseShadow();
    const shadow = new Audio();
    shadow.preload = "auto";
    shadow.volume = 0;
    shadow.src = url;
    shadow.addEventListener(
      "canplay",
      () => {
        if (state.shadow !== shadow) return;
        const now = trackClock();
        shadow.currentTime = now ? now.positionS : clock.positionS;
        if (state.video && !state.video.paused)
          shadow.play().catch((error: unknown) => {
            console.warn("blend.script: operation failed", error);
          });
        report("armed", { videoId });
      },
      { once: true }
    );
    shadow.addEventListener("error", () => {
      if (state.shadow !== shadow) return;
      report("armFailed", { videoId, reason: `media error ${shadow.error ? shadow.error.code : "?"}` });
      state.failedUrl = url;
      state.shadow = null;
      state.shadowVideoId = null;
    });
    state.shadow = shadow;
    state.shadowVideoId = videoId;
  };

  const syncShadow = (positionS: number) => {
    const shadow = state.shadow;
    if (!shadow || shadow.readyState < 2) return;
    if (!state.video || state.video.paused) {
      if (!shadow.paused) shadow.pause();
      return;
    }
    if (shadow.paused)
      shadow.play().catch((error: unknown) => {
        console.warn("blend.script: operation failed", error);
      });
    if (Math.abs(shadow.currentTime - positionS) > syncToleranceS) shadow.currentTime = positionS;
  };

  const setOutGain = (value: number, timeConstant: number) => {
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
      (configuration().seconds * 2 + 8) * 1000
    );
  };

  const abort = (reason: string | null) => {
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
    const remainingS = state.ramp ? state.ramp.endsAt - performance.now() / 1000 : configuration().seconds;
    const fadeInS = Math.max(minFadeInS, remainingS);
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

  const startBlend = (level: number, isAdvance: boolean) => {
    if (!state.shadow) return;
    const seconds = configuration().seconds;
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
      }, rampTickMs),
    };

    state.phase = "blending";
    state.pendingFadeIn = true;
    state.awaitingAdvance = isAdvance;
    state.blends += 1;
    setOutGain(0, 0.02);
    armWatchdog();
    if (isAdvance) {
      const host = playerBar();
      const next = host?.querySelector(".next-button");
      if (next && "click" in next && typeof next.click === "function") {
        Reflect.apply(next.click, next, []);
      } else {
        reportOnce("advance", "advanceFallback", {});
        const api = playerApi();
        if (api?.nextVideo) api.nextVideo();
      }
    }
  };

  const shadowSounding = () => !!state.shadow && state.shadow.readyState >= 2 && !state.shadow.paused;

  const loadInProgress = () => {
    const api = playerApi();
    const playerState = api?.getPlayerState ? api.getPlayerState() : null;
    return playerState === -1 || playerState === 3;
  };

  const gated = () => {
    if (configuration().adPlaying) return "ad playing";
    if (configuration().repeatOne) return "repeat one";
    return null;
  };
  const suppression = (clock: BlendClock | null) => gated() ?? (clock ? null : "no track clock");

  const onTrackChange = (previous: string | null) => {
    if (!state.video) return;
    if (state.phase === "blending" || state.pendingFadeIn) {
      state.awaitingAdvance = false;
      if (!state.video.paused) beginFadeIn();
      return;
    }
    const last = state.lastClock;
    state.lastClock = null;
    const isNearEnd = !!last && last.positionS >= last.durationS - configuration().seconds - triggerSlackS;
    if (previous && !configuration().blendSkips && !isNearEnd) {
      report("cut", { reason: "skip" });
      releaseShadow();
      return;
    }
    const isReady = state.shadowVideoId === previous && shadowSounding();
    if (previous && isReady && !gated()) {
      startBlend(earLevel(state.video), false);
      report("blend", { kind: "skip", seconds: configuration().seconds });
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
    state.lastClock = clock;

    if (state.pendingFadeIn && !state.awaitingAdvance && !video.paused && video.readyState >= 3) beginFadeIn();

    const reason = suppression(clock);
    if (reason) {
      if (state.phase !== "idle" || state.outLevel !== 1) abort(reason);
      if (clock && clock.positionS > 5) reportOnce("suppressed", "suppressed", { reason });
      return;
    }
    if (state.phase !== "idle" || !clock) return;

    if (state.shadowVideoId !== videoId) armShadow(videoId, clock);
    else syncShadow(clock.positionS);

    if (clock.positionS < clock.durationS - configuration().seconds - triggerSlackS) return;
    if (!configuration().hasNext) {
      reportOnce("suppressed", "suppressed", { reason: "no next track" });
      return;
    }
    if (!shadowSounding()) {
      reportOnce("suppressed", "suppressed", { reason: "shadow not ready" });
      return;
    }
    startBlend(earLevel(video), true);
    report("blend", { kind: "end", seconds: configuration().seconds });
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
    if (state.phase === "blending" && state.shadow && state.video?.muted) state.shadow.volume = 0;
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
    delete pageWindow.__ytmdBlend;
  };

  return attach();
}
