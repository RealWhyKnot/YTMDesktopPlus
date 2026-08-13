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

  let state = window.__ytmdDjCrossfade;
  if (!state) {
    state = {
      config: null,
      video: null,
      phase: "idle",
      pendingFadeIn: false,
      lastVideoId: null,
      outLevel: 1,
      prep: null,
      shadow: null,
      handlers: null
    };
    window.__ytmdDjCrossfade = state;
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
    hasNext: options.hasNext !== false
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

  const abortTransition = () => {
    stopShadow();
    state.phase = "idle";
    state.pendingFadeIn = false;
    if (state.outLevel !== 1) setOutGain(1, 0.05);
  };

  // Recovers the playing track's audio: the newest audio segment URL with
  // range and ump stripped returns the whole file, which decodes to PCM. Only
  // the tail needed for the fade is kept; the full decode is let go.
  const prepare = (videoId, durationS) => {
    if (state.prep && state.prep.videoId === videoId) return;
    const prep = { videoId, tail: null, tailStartS: 0, failed: false };
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
      } catch {
        if (state.prep === prep) prep.failed = true;
      }
    })();
  };

  const startOverlap = video => {
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
    const fadeS = Math.min(state.config.fadeOutS, tailLeftS);
    shadowGain.gain.setValueCurveAtTime(buildCurve("out", level), context.currentTime, fadeS);
    source.onended = () => {
      if (state.shadow && state.shadow.source === source) state.shadow = null;
    };
    state.shadow = { source, gain: shadowGain };
    state.overlapCount = (state.overlapCount || 0) + 1;

    setOutGain(0, 0.02);
    state.phase = "overlap";
    state.pendingFadeIn = true;
    const bar = playerBar();
    if (bar && bar.playerApi && bar.playerApi.nextVideo) bar.playerApi.nextVideo();
    return true;
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
  };

  const onTimeUpdate = () => {
    const config = state.config;
    const video = state.video;
    if (!config || !video) return;

    const videoId = currentVideoId();
    if (videoId && videoId !== state.lastVideoId) {
      const wasOverlap = state.phase === "overlap";
      state.lastVideoId = videoId;
      if (wasOverlap || state.pendingFadeIn) {
        if (!video.paused) beginFadeIn();
      } else {
        state.prep = null;
      }
      return;
    }

    if (!config.enabled || config.adPlaying || !isFinite(video.duration) || video.duration <= 0) {
      if (state.phase !== "idle" || state.outLevel !== 1) abortTransition();
      return;
    }
    if (config.repeatOne && !config.fadeOnRepeatOne) {
      if (state.outLevel !== 1) setOutGain(1, 0.05);
      return;
    }
    if (state.phase !== "idle") return;

    const remaining = video.duration - video.currentTime;
    if (remaining <= config.fadeOutS + 0.25) {
      const ready = state.prep && state.prep.videoId === state.lastVideoId && state.prep.tail;
      if (ready && config.hasNext && !roomCaptureActive()) {
        if (!startOverlap(video)) plainFadeTick(remaining);
      } else {
        plainFadeTick(remaining);
      }
    } else {
      if (remaining <= config.fadeOutS + PREP_LEAD_S && videoId) prepare(videoId, video.duration);
      // Recovery net: a loadstart can pin the gain to zero after the playing
      // event already fired, which would otherwise stay silent forever.
      if (state.pendingFadeIn && !video.paused && video.readyState >= 3) beginFadeIn();
      else if (state.outLevel !== 1) setOutGain(1, 0.05);
    }
  };

  function plainFadeTick(remaining) {
    const t = Math.min(1, Math.max(0, 1 - remaining / state.config.fadeOutS));
    const gain = graph.out.gain;
    gain.cancelScheduledValues(graph.context.currentTime);
    gain.setTargetAtTime(curveValue(t, "out"), graph.context.currentTime, 0.08);
    state.outLevel = curveValue(t, "out");
    state.pendingFadeIn = true;
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
    if (state.phase === "overlap") abortTransition();
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
