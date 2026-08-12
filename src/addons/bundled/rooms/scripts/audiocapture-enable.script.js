(function () {
  const video = document.querySelector("video");
  if (!video || window.__ytmdAudioStream) return "";

  const base = window.__ytmdEnsureAudioGraph?.();
  if (!base) return "";
  const context = base.context;

  // The element's volume applies before the graph, which would put the local
  // slider on the broadcast. So the element is pinned to full volume and the
  // slider is re-implemented as a gain on the ear path only. An own accessor
  // on the element keeps YTM and the ratio-volume patch none the wiser.
  //
  // Exponent matches the ratio-volume script; these files cannot import.
  const EXPONENT = 3;
  const nativeDesc = window.HTMLMediaElement_volume ?? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
  const ratioActive = () => {
    const current = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
    return current.get !== nativeDesc.get;
  };

  const localGain = context.createGain();
  const tap = context.createMediaStreamDestination();
  let virtualVolume = video.volume;
  localGain.gain.value = nativeDesc.get.call(video);

  // Ear path runs through localGain and rejoins the shared output; the tap comes
  // off ahead of it so the local slider never reaches listeners.
  base.source.disconnect();
  base.source.connect(localGain);
  localGain.connect(base.out);
  base.source.connect(tap);
  nativeDesc.set.call(video, 1);

  const effectiveVolume = () => (ratioActive() ? Math.pow(virtualVolume, EXPONENT) : virtualVolume);
  Object.defineProperty(video, "volume", {
    configurable: true,
    get: () => virtualVolume,
    set: value => {
      virtualVolume = value;
      localGain.gain.setTargetAtTime(effectiveVolume(), context.currentTime, 0.01);
    }
  });

  const onVolumeChange = () => window.ytmd.postAddonMessage("rooms", "captureStatus", { muted: video.muted });
  video.addEventListener("volumechange", onVolumeChange);

  // The shared context runs at the device rate, which Opus may not accept, so
  // the tap crosses into a dedicated capture context that resamples to 48k.
  const captureContext = new AudioContext({ sampleRate: 48000 });
  const bridgeSource = captureContext.createMediaStreamSource(tap.stream);
  const bridgeDest = captureContext.createMediaStreamDestination();
  bridgeSource.connect(bridgeDest);
  if (captureContext.state === "suspended") captureContext.resume();

  const state = {
    localGain,
    tap,
    captureContext,
    bridgeSource,
    bridgeDest,
    nativeDesc,
    effectiveVolume,
    onVolumeChange,
    pending: [],
    flushTimer: 0,
    reader: null,
    encoder: null,
    stopped: false,
    batchesSent: 0
  };
  window.__ytmdAudioStream = state;

  state.encoder = new AudioEncoder({
    output: chunk => {
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      state.pending.push({ t: chunk.timestamp, d: data });
    },
    error: err => {
      window.ytmd.postAddonMessage("rooms", "captureStatus", { error: String(err) });
    }
  });
  state.encoder.configure({ codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 });

  const processor = new MediaStreamTrackProcessor({ track: bridgeDest.stream.getAudioTracks()[0] });
  state.reader = processor.readable.getReader();

  const pump = async () => {
    for (;;) {
      let result;
      try {
        result = await state.reader.read();
      } catch {
        return;
      }
      if (result.done || state.stopped) return;
      if (state.encoder.state === "configured") state.encoder.encode(result.value);
      result.value.close();
    }
  };
  pump();

  state.flushTimer = setInterval(() => {
    if (state.pending.length === 0) return;
    const packets = state.pending;
    state.pending = [];
    state.batchesSent += 1;
    window.ytmd.postAddonMessage("rooms", "audioChunks", packets);
  }, 250);

  window.ytmd.postAddonMessage("rooms", "captureStatus", { cfg: { sr: 48000, ch: 2, br: 128000 }, muted: video.muted });
  return "";
})
