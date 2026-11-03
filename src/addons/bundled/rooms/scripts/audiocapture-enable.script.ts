export function runScript() {
  const pageWindow: Window & RoomCaptureWindow = window;
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  function isAccessor(value: PropertyDescriptor | undefined): value is MediaAccessor {
    return value !== undefined && typeof value.get === "function" && typeof value.set === "function";
  }
  function isBridge(value: unknown): value is { postAddonMessage(addonId: string, name: string, payload: unknown): unknown } {
    return isRecord(value) && typeof value.postAddonMessage === "function";
  }
  function isStore(value: unknown): value is { getState(): unknown; subscribe(callback: () => void): unknown } {
    return isRecord(value) && typeof value.getState === "function" && typeof value.subscribe === "function";
  }
  const bridge: unknown = Reflect.get(window, "ytmd");
  if (!isBridge(bridge)) return "";
  const video = document.querySelector("video");
  if (!video || pageWindow.__ytmdAudioStream) return "";

  const base = pageWindow.__ytmdEnsureAudioGraph?.();
  if (!base) return "";
  const context = base.context;

  const EXPONENT = 3;
  const nativeDesc = pageWindow.HTMLMediaElement_volume ?? Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
  if (!isAccessor(nativeDesc)) return "";
  const ratioActive = () => {
    const current = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "volume");
    return current?.get !== nativeDesc.get;
  };

  const localGain = context.createGain();
  let virtualVolume = video.volume;
  const mutedDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted");
  if (!isAccessor(mutedDesc)) return "";
  let isVirtualMuted = video.muted;
  let isListening = false;
  const nativeVolume: unknown = nativeDesc.get.call(video);
  if (typeof nativeVolume !== "number") return "";
  localGain.gain.value = nativeVolume;

  base.source.disconnect();
  base.source.connect(localGain);
  localGain.connect(base.out);
  nativeDesc.set.call(video, 1);

  const effectiveVolume = () => (ratioActive() ? Math.pow(virtualVolume, EXPONENT) : virtualVolume);
  const applyEarGain = () => {
    const gain = isListening && isVirtualMuted ? 0 : effectiveVolume();
    localGain.gain.setTargetAtTime(gain, context.currentTime, 0.01);
  };
  Object.defineProperty(video, "volume", {
    configurable: true,
    get: () => virtualVolume,
    set: (value: number) => {
      virtualVolume = value;
      applyEarGain();
    },
  });

  const postMuted = () => bridge.postAddonMessage("rooms", "captureStatus", { muted: isVirtualMuted && !isListening });
  const applyMuted = () => {
    mutedDesc.set.call(video, isVirtualMuted && !isListening);
    applyEarGain();
  };
  Object.defineProperty(video, "muted", {
    configurable: true,
    get: () => isVirtualMuted,
    set: (value: unknown) => {
      isVirtualMuted = Boolean(value);
      applyMuted();
      if (isListening) video.dispatchEvent(new Event("volumechange"));
    },
  });
  const setListening = (isActive: boolean) => {
    if (isListening === isActive) return;
    isListening = isActive;
    applyMuted();
    postMuted();
  };

  const onVolumeChange = () => postMuted();
  video.addEventListener("volumechange", onVolumeChange);

  const hook: unknown = Reflect.get(window, "__YTMD_HOOK__");
  const store = isRecord(hook) && isStore(hook.ytmStore) ? hook.ytmStore : undefined;
  let isAdPlaying = false;
  const readAdPlaying = () => {
    try {
      const snapshot = store?.getState();
      if (!isRecord(snapshot) || !isRecord(snapshot.player)) return isAdPlaying;
      return snapshot.player.adPlaying === true;
    } catch (error: unknown) {
      console.warn("Room capture could not read the ad state", error);
      return isAdPlaying;
    }
  };
  isAdPlaying = readAdPlaying();

  const state: RoomCaptureState = {
    localGain,
    node: null,
    nativeDesc,
    effectiveVolume,
    mutedDesc,
    virtualMuted: () => isVirtualMuted,
    setListening,
    onVolumeChange,
    unsubscribeAd: null,
    stopped: false,
  };
  pageWindow.__ytmdAudioStream = state;

  if (store) {
    state.unsubscribeAd = store.subscribe(() => {
      const isNext = readAdPlaying();
      if (isNext === isAdPlaying) return;
      isAdPlaying = isNext;
      if (state.node) state.node.port.postMessage({ ad: isAdPlaying });
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
        channelInterpretation: "speakers",
      });
      const channel = new MessageChannel();
      node.port.postMessage({ port: channel.port1, ad: isAdPlaying }, [channel.port1]);
      base.source.connect(node);
      state.node = node;
      window.postMessage({ type: "ytmd-room-capture-port" }, "*", [channel.port2]);
    })
    .catch((error: unknown) => {
      bridge.postAddonMessage("rooms", "captureStatus", { error: String(error) });
    });

  bridge.postAddonMessage("rooms", "captureStatus", { muted: isVirtualMuted });
  return "";
}
