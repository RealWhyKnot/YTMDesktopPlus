type MediaAccessor = PropertyDescriptor & {
  get(this: HTMLMediaElement): unknown;
  set(this: HTMLMediaElement, value: unknown): void;
};

type RoomAudioGraph = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  out: GainNode;
};

type RoomCaptureState = {
  localGain: GainNode;
  node: AudioWorkletNode | null;
  nativeDesc: MediaAccessor;
  effectiveVolume(): number;
  mutedDesc: MediaAccessor;
  virtualMuted(): boolean;
  setListening(active: boolean): void;
  onVolumeChange: () => void;
  unsubscribeAd: unknown;
  stopped: boolean;
};

type RoomCaptureWindow = {
  __ytmdAudioStream?: RoomCaptureState;
  __ytmdAudioGraph?: RoomAudioGraph;
  __ytmdEnsureAudioGraph?: () => RoomAudioGraph | null;
  HTMLMediaElement_volume?: PropertyDescriptor;
};
