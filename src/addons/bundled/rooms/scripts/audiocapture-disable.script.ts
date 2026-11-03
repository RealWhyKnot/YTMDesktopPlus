export function runScript() {
  const pageWindow: Window & RoomCaptureWindow = window;
  const state = pageWindow.__ytmdAudioStream;
  if (!state) return "";

  state.stopped = true;
  delete pageWindow.__ytmdAudioStream;

  const step = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      console.error("[ytmd] rooms audio teardown step failed", error);
    }
  };

  const base = pageWindow.__ytmdAudioGraph;
  const video = document.querySelector("video");

  step(() => {
    if (typeof state.unsubscribeAd === "function") Reflect.apply(state.unsubscribeAd, state, []);
  });
  step(() => {
    if (state.node) state.node.port.postMessage({ stop: true });
  });

  if (video) {
    step(() => video.removeEventListener("volumechange", state.onVolumeChange));
    let effective = video.volume;
    step(() => {
      effective = state.effectiveVolume();
    });
    Reflect.deleteProperty(video, "volume");
    step(() => state.nativeDesc.set.call(video, effective));
    let isMuted = video.muted;
    step(() => {
      isMuted = state.virtualMuted();
    });
    Reflect.deleteProperty(video, "muted");
    step(() => state.mutedDesc.set.call(video, isMuted));
  }

  if (base) {
    step(() => {
      base.source.disconnect();
      base.source.connect(base.out);
    });
  }
  step(() => state.localGain.disconnect());

  return "";
}
