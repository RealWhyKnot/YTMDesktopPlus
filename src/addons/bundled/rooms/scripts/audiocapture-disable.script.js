(function () {
  const state = window.__ytmdAudioStream;
  if (!state) return "";

  state.stopped = true;
  delete window.__ytmdAudioStream;
  clearInterval(state.flushTimer);

  const step = fn => {
    try {
      fn();
    } catch (error) {
      console.error("[ytmd] rooms audio teardown step failed", error);
    }
  };

  const base = window.__ytmdAudioGraph;
  const video = document.querySelector("video");

  step(() => {
    if (state.reader) state.reader.cancel().catch(() => {});
  });
  step(() => {
    if (state.encoder && state.encoder.state !== "closed") state.encoder.close();
  });
  step(() => state.captureContext.close().catch(() => {}));

  // Hand the volume back to the element exactly as loud as it was.
  if (video) {
    step(() => video.removeEventListener("volumechange", state.onVolumeChange));
    let effective = video.volume;
    step(() => {
      effective = state.effectiveVolume();
    });
    Reflect.deleteProperty(video, "volume");
    step(() => state.nativeDesc.set.call(video, effective));
  }

  // Ear path back to the plain shared graph; the tap goes away with it. Anything
  // downstream of `out`, such as the volume boost, is left alone.
  if (base) {
    step(() => {
      base.source.disconnect();
      base.source.connect(base.out);
    });
  }
  step(() => state.localGain.disconnect());

  return "";
})
