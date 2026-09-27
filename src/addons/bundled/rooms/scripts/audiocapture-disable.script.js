(function () {
  const state = window.__ytmdAudioStream;
  if (!state) return "";

  state.stopped = true;
  delete window.__ytmdAudioStream;

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
    if (state.node) state.node.port.postMessage({ stop: true });
  });

  // Hand the volume back to the element exactly as loud as it was.
  if (video) {
    step(() => video.removeEventListener("volumechange", state.onVolumeChange));
    let effective = video.volume;
    step(() => {
      effective = state.effectiveVolume();
    });
    Reflect.deleteProperty(video, "volume");
    step(() => state.nativeDesc.set.call(video, effective));
    let muted = video.muted;
    step(() => {
      muted = state.virtualMuted();
    });
    Reflect.deleteProperty(video, "muted");
    step(() => state.mutedDesc.set.call(video, muted));
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
