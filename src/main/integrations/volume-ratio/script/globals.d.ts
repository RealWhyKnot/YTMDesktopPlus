type VolumeDescriptor = {
  get?: (this: HTMLMediaElement) => unknown;
  set?: (this: HTMLMediaElement, value: number) => void;
};

type VolumeRatioWindow = {
  __ytmdVolumeRatio?: boolean;
  HTMLMediaElement_volume?: VolumeDescriptor;
};
