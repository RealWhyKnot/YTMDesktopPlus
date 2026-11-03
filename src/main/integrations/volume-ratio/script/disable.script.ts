export function runScript() {
  const pageWindow: Window & VolumeRatioWindow = window;
  if (typeof pageWindow.HTMLMediaElement_volume?.get !== "undefined" && typeof pageWindow.HTMLMediaElement_volume.set !== "undefined") {
    Object.defineProperty(HTMLMediaElement.prototype, "volume", {
      get: pageWindow.HTMLMediaElement_volume.get,
      set: pageWindow.HTMLMediaElement_volume.set,
    });
  }

  pageWindow.__ytmdVolumeRatio = false;
}
