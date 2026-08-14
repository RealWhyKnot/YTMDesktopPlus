// Blends song changes. Near the end of a track it recovers the track's own
// audio from the player's segment URLs, keeps the tail playing through a
// buffer source while the player skips ahead, and fades the incoming track in
// over it. When the tail cannot be recovered it falls back to a plain fade
// through the shared graph's out gain.
//
// The fade lives on graph.out.gain, which no other feature automates: rooms
// splices ahead of out and volume boost hangs off the far side, so both
// survive and a room broadcast never hears the fade.

(function (options) {
  const graph = window.__ytmdEnsureAudioGraph && window.__ytmdEnsureAudioGraph();
  if (!graph) return false;

  const PREP_LEAD_S = 20;
  const TAIL_MARGIN_S = 2;
  const CURVE_POINTS = 65;
  const PREP_ATTEMPTS = 3;
  const PREP_RETRY_GAP_MS = 4000;

  let state = window.__ytmdDjCrossfade;
  if (!state) {
    state = {
      config: null,
      video: null,
      phase: "idle",
      pendingFadeIn: false,
      transitionPosted: false,
      lastVideoId: null,
      outLevel: 1,
      reported: {},
      silenceGuard: null,
      prep: null,
      shadow: null,
      rateGlide: null,
      handlers: null
    };
    window.__ytmdDjCrossfade = state;
  }

  // Resource timing is how this script and the catalog both find the segment
  // URL. The default 250-entry buffer fills on a page left open for hours and
  // then silently stops recording, so keep it large and recycle it when full.
  if (!state.resourceBufferHooked) {
    state.resourceBufferHooked = true;
    if (performance.setResourceTimingBufferSize) performance.setResourceTimingBufferSize(1000);
    if (performance.addEventListener) performance.addEventListener("resourcetimingbufferfull", () => performance.clearResourceTimings());
  }

  state.config = {
    enabled: options.enabled !== false,
    fadeOutS: Math.min(12, Math.max(1, Number(options.fadeOutS) || 5)),
    fadeInS: Math.min(8, Math.max(0.3, Number(options.fadeInS) || 1.5)),
    curve: Number(options.curve) || 0,
    fadeOnManualSkip: options.fadeOnManualSkip !== false,
    fadeOnRepeatOne: options.fadeOnRepeatOne === true,
    repeatOne: options.repeatOne === true,
    adPlaying: options.adPlaying === true,
    hasNext: options.hasNext !== false,
    transitionIndex: Number.isInteger(options.transitionIndex) ? options.transitionIndex : null,
    beatOffsetS: typeof options.beatOffsetS === "number" && isFinite(options.beatOffsetS) ? options.beatOffsetS : null,
    beatPeriodS: typeof options.beatPeriodS === "number" && options.beatPeriodS > 0 ? options.beatPeriodS : null,
    incomingRate: typeof options.incomingRate === "number" && options.incomingRate >= 0.9 && options.incomingRate <= 1.1 ? options.incomingRate : null,
    rateGlideS: Math.min(20, Math.max(1, Number(options.rateGlideS) || 6))
  };

  const playerBar = () => document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const currentVideoId = () => {
    const bar = playerBar();
    const data = bar && bar.playerApi && bar.playerApi.getVideoData && bar.playerApi.getVideoData();
    return (data && data.video_id) || null;
  };
  const nativeVolume = video => {
    const descriptor = window.HTMLMediaElement_volume;
    return descriptor && descriptor.get ? descriptor.get.call(video) : video.volume;
  };
  const roomCaptureActive = () => !!window.__ytmdAudioStream;

  // Every branch below decides silently, so each one says what it did. The
  // ticker runs at ~4Hz: reportOnce keeps that to one line per track.
  const report = (event, detail) => {
    if (!window.ytmd || !window.ytmd.postAddonMessage) return;
    try {
      window.ytmd.postAddonMessage("dj", "diag", Object.assign({ event, videoId: state.lastVideoId }, detail));
    } catch {
      // Bridge gone with the page.
    }
  };
  const reportOnce = (key, event, detail) => {
    if (!state.reported) state.reported = {};
    if (state.reported[key]) return;
    state.reported[key] = true;
    report(event, detail);
  };

  // t runs 0..1 across the fade; both directions stay near equal power at the
  // crossing point so the sum does not dip or bump.
  const curveValue = (t, direction) => {
    const kind = state.config.curve;
    if (kind === 1) return direction === "out" ? 1 - t : t;
    if (kind === 2) {
      const db = direction === "out" ? -60 * t : -60 * (1 - t);
      return t === (direction === "out" ? 1 : 0) ? 0 : Math.pow(10, db / 20);
    }
    return direction === "out" ? Math.cos((t * Math.PI) / 2) : Math.sin((t * Math.PI) / 2);
  };
  const buildCurve = (direction, scale) => {
    const values = new Float32Array(CURVE_POINTS);
    for (let i = 0; i < CURVE_POINTS; i++) values[i] = curveValue(i / (CURVE_POINTS - 1), direction) * scale;
    return values;
  };

  const setOutGain = (value, timeConstant) => {
    const gain = graph.out.gain;
    gain.cancelScheduledValues(graph.context.currentTime);
    if (timeConstant) gain.setTargetAtTime(value, graph.context.currentTime, timeConstant);
    else gain.setValueAtTime(value, graph.context.currentTime);
    state.outLevel = value;
  };

  const stopShadow = () => {
    if (!state.shadow) return;
    try {
      state.shadow.source.onended = null;
      state.shadow.source.stop();
    } catch {
      // Already ended.
    }
    try {
      state.shadow.source.disconnect();
      state.shadow.gain.disconnect();
    } catch {
      // Never connected.
    }
    state.shadow = null;
  };

  // Last line of defence for the one failure that is worse than a bad mix: a
  // faded-out track whose successor never plays leaves the gain at zero with
  // no event coming to lift it. Written straight to the param, since a
  // scheduled ramp needs a running context clock to move at all.
  const clearSilenceGuard = () => {
    if (!state.silenceGuard) return;
    clearTimeout(state.silenceGuard);
    state.silenceGuard = null;
  };
  const armSilenceGuard = () => {
    clearSilenceGuard();
    const budgetS = state.config.fadeOutS + state.config.fadeInS + 8;
    state.silenceGuard = setTimeout(() => {
      state.silenceGuard = null;
      if (!state.pendingFadeIn && state.outLevel === 1) return;
      stopShadow();
      state.phase = "idle";
      state.pendingFadeIn = false;
      graph.out.gain.cancelScheduledValues(graph.context.currentTime);
      graph.out.gain.value = 1;
      state.outLevel = 1;
      report("silenceRecovered", { videoId: currentVideoId() });
    }, budgetS * 1000);
  };

  const abortTransition = () => {
    clearSilenceGuard();
    stopShadow();
    clearRateGlide();
    state.phase = "idle";
    state.pendingFadeIn = false;
    if (state.outLevel !== 1) setOutGain(1, 0.05);
  };

  // Recovers the playing track's audio: the newest audio segment URL with
  // range and ump stripped returns the whole file, which decodes to PCM. Only
  // the tail needed for the fade is kept; the full decode is let go.
  const prepare = (videoId, durationS) => {
    const previous = state.prep && state.prep.videoId === videoId ? state.prep : null;
    // A miss is usually the segment URL not being visible yet, so retry a few
    // times inside the prep window rather than giving up on the track.
    if (previous && (!previous.failed || previous.attempts >= PREP_ATTEMPTS || Date.now() - previous.failedAt < PREP_RETRY_GAP_MS)) return;
    const prep = { videoId, tail: null, tailStartS: 0, failed: false, failedAt: 0, attempts: (previous ? previous.attempts : 0) + 1 };
    state.prep = prep;
    (async () => {
      try {
        const entries = performance.getEntriesByType("resource").filter(e => /videoplayback/.test(e.name) && /mime=audio/.test(e.name));
        if (!entries.length) throw new Error("no audio segment urls");
        const url = new URL(entries[entries.length - 1].name);
        for (const p of ["range", "rn", "rbuf", "ump", "srfvp", "alr"]) url.searchParams.delete(p);
        const response = await fetch(url.toString(), { credentials: "omit" });
        if (!response.ok) throw new Error("http " + response.status);
        const encoded = await response.arrayBuffer();
        const decoded = await graph.context.decodeAudioData(encoded);
        const tailStartS = Math.max(0, Math.min(decoded.duration, durationS) - state.config.fadeOutS - TAIL_MARGIN_S);
        const startFrame = Math.floor(tailStartS * decoded.sampleRate);
        const frames = decoded.length - startFrame;
        if (frames < decoded.sampleRate) throw new Error("tail too short");
        const tail = graph.context.createBuffer(decoded.numberOfChannels, frames, decoded.sampleRate);
        for (let ch = 0; ch < decoded.numberOfChannels; ch++) tail.copyToChannel(decoded.getChannelData(ch).subarray(startFrame), ch);
        if (state.prep === prep) {
          prep.tail = tail;
          prep.tailStartS = tailStartS;
        }
        report("prepReady", { videoId, tailS: Math.round(tail.duration * 10) / 10 });
      } catch (error) {
        if (state.prep === prep) {
          prep.failed = true;
          prep.failedAt = Date.now();
        }
        report("prepFailed", { videoId, attempt: prep.attempts, reason: String((error && error.message) || error) });
      }
    })();
  };

  const advance = () => {
    if (state.config.transitionIndex != null && window.ytmd && window.ytmd.postAddonMessage) {
      window.ytmd.postAddonMessage("dj", "transitionNow", { index: state.config.transitionIndex });
      return;
    }
    const bar = playerBar();
    if (bar && bar.playerApi && bar.playerApi.nextVideo) bar.playerApi.nextVideo();
  };

  const startOverlap = (video, fadeS) => {
    const prep = state.prep;
    const context = graph.context;
    // The shadow bypasses the element, so element mute has to be mirrored by
    // hand or muted playback would still be audible during the blend.
    const level = video.muted ? 0 : nativeVolume(video);
    const offset = Math.max(0, video.currentTime - prep.tailStartS);
    const tailLeftS = prep.tail.duration - offset;
    if (tailLeftS < 0.5) return false;

    const shadowGain = context.createGain();
    shadowGain.gain.value = level;
    const source = context.createBufferSource();
    source.buffer = prep.tail;
    source.connect(shadowGain);
    shadowGain.connect(context.destination);
    source.start(context.currentTime, offset);
    shadowGain.gain.setValueCurveAtTime(buildCurve("out", level), context.currentTime, Math.min(fadeS, tailLeftS));
    source.onended = () => {
      if (state.shadow && state.shadow.source === source) state.shadow = null;
    };
    state.shadow = { source, gain: shadowGain };
    state.overlapCount = (state.overlapCount || 0) + 1;

    setOutGain(0, 0.02);
    state.phase = "overlap";
    state.pendingFadeIn = true;
    armSilenceGuard();
    advance();
    return true;
  };

  // The configured window, snapped back to the outgoing track's last downbeat
  // when a beat grid was pushed.
  const fadeStartSeconds = durationS => {
    const config = state.config;
    const unaligned = durationS - config.fadeOutS;
    if (config.beatOffsetS == null || config.beatPeriodS == null || unaligned <= config.beatOffsetS) return unaligned;
    const beats = Math.floor((unaligned - config.beatOffsetS) / config.beatPeriodS);
    return config.beatOffsetS + beats * config.beatPeriodS;
  };

  const clearRateGlide = () => {
    if (!state.rateGlide) return;
    if (state.video) state.video.playbackRate = 1;
    state.rateGlide = null;
  };

  const beginFadeIn = () => {
    const gain = graph.out.gain;
    const now = graph.context.currentTime;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(0, now);
    gain.setValueCurveAtTime(buildCurve("in", 1), now, state.config.fadeInS);
    state.outLevel = 1;
    state.pendingFadeIn = false;
    state.phase = "idle";
    clearSilenceGuard();
    // Tempo-match the incoming track, easing back to natural speed. Skip when
    // something else already runs the element off its normal rate.
    const video = state.video;
    if (video && state.config.incomingRate != null && video.playbackRate === 1) {
      video.preservesPitch = true;
      video.playbackRate = state.config.incomingRate;
      state.rateGlide = { stepPerTick: (1 - state.config.incomingRate) / (state.config.rateGlideS * 4) };
    }
  };

  const onTimeUpdate = () => {
    const config = state.config;
    const video = state.video;
    if (!config || !video) return;

    const videoId = currentVideoId();
    if (videoId && videoId !== state.lastVideoId) {
      const wasOverlap = state.phase === "overlap";
      state.lastVideoId = videoId;
      state.transitionPosted = false;
      state.reported = {};
      clearRateGlide();
      if (wasOverlap || state.pendingFadeIn) {
        if (!video.paused) beginFadeIn();
      } else {
        state.prep = null;
      }
      return;
    }

    if (state.rateGlide) {
      if (video.playbackRate === 1) {
        state.rateGlide = null;
      } else {
        const next = video.playbackRate + state.rateGlide.stepPerTick;
        if (Math.abs(next - 1) < 0.003 || (state.rateGlide.stepPerTick > 0) === (next > 1)) clearRateGlide();
        else video.playbackRate = next;
      }
    }

    if (!config.enabled || config.adPlaying || !isFinite(video.duration) || video.duration <= 0) {
      if (state.phase !== "idle" || state.outLevel !== 1) abortTransition();
      // Duration is briefly unknown at every track start; only a state that
      // outlives the opening seconds is worth reporting.
      if (video.currentTime > 5) {
        reportOnce("suppressed", "suppressed", { reason: !config.enabled ? "disabled" : config.adPlaying ? "ad playing" : "duration unknown" });
      }
      return;
    }
    if (config.repeatOne && !config.fadeOnRepeatOne) {
      if (state.outLevel !== 1) setOutGain(1, 0.05);
      if (video.currentTime > 5) reportOnce("suppressed", "suppressed", { reason: "repeat one" });
      return;
    }
    if (state.phase !== "idle") return;

    const fadeStartS = fadeStartSeconds(video.duration);
    const fadeLengthS = video.duration - fadeStartS;
    if (video.currentTime >= fadeStartS - 0.12) {
      const ready = state.prep && state.prep.videoId === state.lastVideoId && state.prep.tail;
      const roomCapture = roomCaptureActive();
      if (ready && config.hasNext && !roomCapture) {
        if (startOverlap(video, fadeLengthS)) {
          reportOnce("transition", "overlap", { fadeS: Math.round(fadeLengthS * 10) / 10 });
        } else {
          plainFadeTick(video, fadeLengthS);
          reportOnce("transition", "plainFade", { reason: "tail ran out before the fade" });
        }
      } else {
        plainFadeTick(video, fadeLengthS);
        reportOnce("transition", "plainFade", {
          reason: !ready
            ? state.prep && state.prep.failed
              ? "tail unavailable"
              : "tail not ready in time"
            : !config.hasNext
              ? "no next track"
              : "room capture active"
        });
      }
    } else {
      if (video.duration - video.currentTime <= config.fadeOutS + PREP_LEAD_S && videoId) prepare(videoId, video.duration);
      // Recovery net: a loadstart can pin the gain to zero after the playing
      // event already fired, which would otherwise stay silent forever.
      if (state.pendingFadeIn && !video.paused && video.readyState >= 3) beginFadeIn();
      else if (state.outLevel !== 1) setOutGain(1, 0.05);
    }
  };

  function plainFadeTick(video, fadeLengthS) {
    const remaining = video.duration - video.currentTime;
    const t = Math.min(1, Math.max(0, 1 - remaining / fadeLengthS));
    const gain = graph.out.gain;
    gain.cancelScheduledValues(graph.context.currentTime);
    gain.setTargetAtTime(curveValue(t, "out"), graph.context.currentTime, 0.08);
    state.outLevel = curveValue(t, "out");
    if (!state.pendingFadeIn) {
      state.pendingFadeIn = true;
      armSilenceGuard();
    }
    // A directed pick still has to happen without a shadow; jump just before
    // the element runs out so the plain fade lands on the chosen track.
    if (state.config.transitionIndex != null && remaining <= 1 && !state.transitionPosted) {
      state.transitionPosted = true;
      advance();
    }
  }

  const onLoadStart = () => {
    if (!state.config.enabled) return;
    if (state.phase === "overlap" || state.pendingFadeIn || state.config.fadeOnManualSkip) {
      setOutGain(0);
      state.pendingFadeIn = true;
    }
  };

  const onPlaying = () => {
    if (!state.config.enabled) return;
    if (state.pendingFadeIn) beginFadeIn();
  };

  const onPause = () => {
    // A faded-out track that stops without the next one ever playing would
    // leave the gain at zero with no tick coming to lift it, so the app would
    // sit silent until the user found the volume themselves.
    if (state.phase === "overlap" || state.pendingFadeIn) abortTransition();
  };

  const onSeeking = () => {
    if (state.phase === "overlap") abortTransition();
  };

  const onVolumeChange = () => {
    if (state.shadow && state.video && state.video.muted) stopShadow();
  };

  const attach = () => {
    const video = document.querySelector("video");
    if (!video) return false;
    if (state.video === video && state.handlers) return true;
    detach();
    state.video = video;
    state.handlers = { onTimeUpdate, onLoadStart, onPlaying, onPause, onSeeking, onVolumeChange };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadstart", onLoadStart);
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
    state.video.removeEventListener("loadstart", state.handlers.onLoadStart);
    state.video.removeEventListener("playing", state.handlers.onPlaying);
    state.video.removeEventListener("pause", state.handlers.onPause);
    state.video.removeEventListener("seeking", state.handlers.onSeeking);
    state.video.removeEventListener("volumechange", state.handlers.onVolumeChange);
    state.video = null;
    state.handlers = null;
  }

  state.detachAll = () => {
    abortTransition();
    detach();
    state.prep = null;
    delete window.__ytmdDjCrossfade;
  };

  if (!state.config.enabled) {
    abortTransition();
    return true;
  }
  return attach();
});
