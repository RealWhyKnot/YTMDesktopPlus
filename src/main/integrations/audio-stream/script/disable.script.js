(function () {
  const state = window.__ytmdAudioStream;
  const base = window.__ytmdLoudnessNormalization;
  const video = document.querySelector("video");
  if (!state || !base || !video) return "";

  state.stopped = true;
  clearInterval(state.flushTimer);
  if (state.reader) {
    state.reader.cancel().catch(() => {});
  }
  if (state.encoder && state.encoder.state !== "closed") state.encoder.close();
  state.captureContext.close().catch(() => {});

  // Hand the volume back to the element exactly as loud as it was.
  video.removeEventListener("volumechange", state.onVolumeChange);
  const effective = state.effectiveVolume();
  Reflect.deleteProperty(video, "volume");
  state.nativeDesc.set.call(video, effective);

  // Ear path back to the plain shared graph; the tap goes away with it.
  base.gain.disconnect();
  base.gain.connect(base.context.destination);
  state.localGain.disconnect();

  delete window.__ytmdAudioStream;
  return "";
})
