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
  let virtualVolume = video.volume;
  const mutedDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted");
  let virtualMuted = video.muted;
  let listening = false;
  localGain.gain.value = nativeDesc.get.call(video);

  // Ear path runs through localGain and rejoins the shared output; the tap comes
  // off ahead of it so the local slider never reaches listeners.
  base.source.disconnect();
  base.source.connect(localGain);
  localGain.connect(base.out);
  nativeDesc.set.call(video, 1);

  const effectiveVolume = () => (ratioActive() ? Math.pow(virtualVolume, EXPONENT) : virtualVolume);
  const applyEarGain = () => {
    const gain = listening && virtualMuted ? 0 : effectiveVolume();
    localGain.gain.setTargetAtTime(gain, context.currentTime, 0.01);
  };
  Object.defineProperty(video, "volume", {
    configurable: true,
    get: () => virtualVolume,
    set: value => {
      virtualVolume = value;
      applyEarGain();
    }
  });

  const postMuted = () => window.ytmd.postAddonMessage("rooms", "captureStatus", { muted: virtualMuted && !listening });
  const applyMuted = () => {
    mutedDesc.set.call(video, virtualMuted && !listening);
    applyEarGain();
  };
  Object.defineProperty(video, "muted", {
    configurable: true,
    get: () => virtualMuted,
    set: value => {
      virtualMuted = Boolean(value);
      applyMuted();
      if (listening) video.dispatchEvent(new Event("volumechange"));
    }
  });
  const setListening = active => {
    if (listening === active) return;
    listening = active;
    applyMuted();
    postMuted();
  };

  const onVolumeChange = () => postMuted();
  video.addEventListener("volumechange", onVolumeChange);

  const hook = window.__YTMD_HOOK__;
  let adPlaying = false;
  const readAdPlaying = () => {
    try {
      return hook.ytmStore.getState().player.adPlaying === true;
    } catch {
      return adPlaying;
    }
  };
  adPlaying = readAdPlaying();

  const state = {
    localGain,
    node: null,
    nativeDesc,
    effectiveVolume,
    mutedDesc,
    virtualMuted: () => virtualMuted,
    setListening,
    onVolumeChange,
    unsubscribeAd: null,
    stopped: false
  };
  window.__ytmdAudioStream = state;

  if (hook && hook.ytmStore) {
    state.unsubscribeAd = hook.ytmStore.subscribe(() => {
      const next = readAdPlaying();
      if (next === adPlaying) return;
      adPlaying = next;
      if (state.node) state.node.port.postMessage({ ad: adPlaying });
    });
  }

  context.audioWorklet
    .addModule("ytmd-media://capture/worklet.js")
    .then(() => {
      if (state.stopped) return;
      const node = new AudioWorkletNode(context, "ytmd-room-capture", {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers"
      });
      const channel = new MessageChannel();
      node.port.postMessage({ port: channel.port1, ad: adPlaying }, [channel.port1]);
      base.source.connect(node);
      state.node = node;
      window.postMessage({ type: "ytmd-room-capture-port" }, "*", [channel.port2]);
    })
    .catch(error => {
      window.ytmd.postAddonMessage("rooms", "captureStatus", { error: String(error) });
    });

  window.ytmd.postAddonMessage("rooms", "captureStatus", { muted: virtualMuted });
  return "";
})
