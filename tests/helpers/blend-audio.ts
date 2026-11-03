import { requireValue } from "./require-value";
import { vi } from "vitest";

type GainRecord = { method: string; value?: number | Float32Array; time?: number; duration?: number };

export function fakeGainParam() {
  const calls: GainRecord[] = [];
  return {
    value: 1,
    calls,
    cancelScheduledValues: vi.fn((time: number) => calls.push({ method: "cancel", time })),
    setValueAtTime: vi.fn((value: number, time: number) => calls.push({ method: "set", value, time })),
    setTargetAtTime: vi.fn((value: number, time: number, duration: number) => calls.push({ method: "target", value, time, duration })),
    setValueCurveAtTime: vi.fn((value: Float32Array, time: number, duration: number) => calls.push({ method: "curve", value, time, duration })),
  };
}

export function createAudio() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const audio = {
    volume: 1,
    currentTime: 0,
    paused: true,
    readyState: 0,
    preload: "",
    src: "",
    error: null as { code: number } | null,
    played: new Array<number>(),
    isRefusePlay: false,
    addEventListener(type: string, listener: (...args: unknown[]) => void) {
      if (!handlers.has(type)) handlers.set(type, []);
      requireValue(handlers.get(type)).push(listener);
    },
    removeEventListener() {
      return undefined;
    },
    pause() {
      audio.paused = true;
    },
    play() {
      if (audio.isRefusePlay) return Promise.reject(new Error("NotAllowedError"));
      audio.paused = false;
      audio.played.push(audio.currentTime);
      return Promise.resolve();
    },
    load() {
      return undefined;
    },
    removeAttribute(name: string) {
      if (name === "src") audio.src = "";
    },
    emit(type: string) {
      for (const listener of [...(handlers.get(type) ?? [])]) listener();
      if (type === "canplay" || type === "error") handlers.delete(type);
    },
    ready() {
      audio.readyState = 4;
      audio.emit("canplay");
    },
  };
  return audio;
}

export function createVideo(listeners: Map<string, (() => void)[]>) {
  return {
    paused: false,
    muted: false,
    readyState: 4,
    volume: 0.83,
    currentTime: 0,
    duration: 200,
    addEventListener: (type: string, listener: () => void) => {
      if (!listeners.has(type)) listeners.set(type, []);
      requireValue(listeners.get(type)).push(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((entry) => entry !== listener)
      );
    },
  };
}
