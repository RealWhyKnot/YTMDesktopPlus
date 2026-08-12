(function () {
  const state = window.__ytmdAudioStream;
  const base = window.__ytmdAudioGraph;
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

  // Ear path back to the plain shared graph; the tap goes away with it. Anything
  // downstream of `out`, such as the volume boost, is left alone.
  base.source.disconnect();
  base.source.connect(base.out);
  state.localGain.disconnect();

  delete window.__ytmdAudioStream;
  return "";
})
