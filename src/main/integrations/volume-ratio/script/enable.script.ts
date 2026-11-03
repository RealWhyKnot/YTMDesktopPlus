export function runScript() {
  const pageWindow: Window & VolumeRatioWindow = window;
  if (pageWindow.__ytmdVolumeRatio) return "";
  pageWindow.__ytmdVolumeRatio = true;

  const EXPONENT = 3;

  const storedOriginalVolumes = new WeakMap<HTMLMediaElement, number>();
  const volumeDescriptor: VolumeDescriptor | undefined = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
  const nativeGet = volumeDescriptor?.get;
  const nativeSet = volumeDescriptor?.set;
  if (nativeGet === undefined || nativeSet === undefined) throw new Error("Native media volume accessors are unavailable");
  Object.defineProperty(HTMLMediaElement.prototype, "volume", {
    get(this: HTMLMediaElement) {
      const lowVolume: unknown = nativeGet.call(this);
      if (typeof lowVolume !== "number") throw new TypeError("Native media volume is not a number");
      const calculatedOriginalVolume = lowVolume ** (1 / EXPONENT);

      const storedOriginalVolume = storedOriginalVolumes.get(this);
      const storedDeviation = Math.abs((storedOriginalVolume ?? NaN) - calculatedOriginalVolume);

      return storedOriginalVolume !== undefined && storedDeviation < 0.01 ? storedOriginalVolume : calculatedOriginalVolume;
    },
    set(this: HTMLMediaElement, originalVolume: number) {
      const lowVolume = originalVolume ** EXPONENT;
      storedOriginalVolumes.set(this, originalVolume);
      nativeSet.call(this, lowVolume);
    },
  });

  pageWindow.HTMLMediaElement_volume = volumeDescriptor;

  return undefined;
}
