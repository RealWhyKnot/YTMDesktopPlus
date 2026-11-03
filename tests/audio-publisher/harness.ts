import { requireValue } from "../helpers/require-value";
import { AudioPublisher, type AudioFault, type AudioTransport, type AudioTransportHandlers } from "../../src/main/integrations/listen-along/audio-publisher";
import { VideoState, type PlayerState } from "../../src/shared/addons/sdk";
import { type AudioClientFrame, type BatchPacket } from "../../src/shared/audio-protocol";
import { makePlayerState, makeVideoDetails } from "../helpers/fake-addon-context";

export function playerState(videoId: string | null, trackState: VideoState, progress = 0, extra: Partial<PlayerState> = {}): PlayerState {
  return makePlayerState({
    videoDetails: videoId
      ? makeVideoDetails({
          id: videoId,
          title: "Song",
          author: "Artist",
          album: "Album",
          durationSeconds: 300,
          thumbnails: [
            { url: "https://i.ytimg.com/small.jpg", width: 60, height: 60 },
            { url: "https://i.ytimg.com/large.jpg", width: 544, height: 544 },
          ],
        })
      : null,
    videoProgress: progress,
    trackState,
    hasFullMetadata: true,
    ...extra,
  });
}

export function packets(at = 0): BatchPacket[] {
  return [{ timestampUs: at, payload: new Uint8Array([1, 2, 3, 4]) }];
}

export function makeHarness() {
  let nowMs = 1_754_236_800_000;
  const textFrames: AudioClientFrame[] = [];
  const binaryFrames: Uint8Array[] = [];
  const updates: { streaming: boolean; webListeners: number }[] = [];
  const capture = { started: 0, stopped: 0 };
  const faults: AudioFault[] = [];
  const transports: { url: string; handlers: AudioTransportHandlers; connected: boolean; closed: boolean; bufferedAmount: number }[] = [];

  const publisher = new AudioPublisher({
    createTransport(url, handlers) {
      const entry = { url, handlers, connected: false, closed: false, bufferedAmount: 0 };
      transports.push(entry);
      const transport: AudioTransport = {
        connect: () => {
          entry.connected = true;
        },
        sendText: (frame) => textFrames.push(frame),
        sendBinary: (data) => binaryFrames.push(data),
        close: () => {
          entry.closed = true;
        },
        get isOpen() {
          return entry.connected && !entry.closed;
        },
        get bufferedAmount() {
          return entry.bufferedAmount;
        },
      };
      return transport;
    },
    startCapture: () => capture.started++,
    stopCapture: () => capture.stopped++,
    onUpdate: (update) => updates.push(update),
    onFault: (fault) => faults.push(fault),
    now: () => nowMs,
    log: () => {
      return undefined;
    },
  });

  return {
    publisher,
    textFrames,
    binaryFrames,
    updates,
    capture,
    faults,
    transports,
    advance(ms: number) {
      nowMs += ms;
    },
    current() {
      return transports[transports.length - 1];
    },
    open() {
      requireValue(this.current()).handlers.onOpen();
    },
    ready(n = 0, extra: { c?: number; v?: number } = {}) {
      requireValue(this.current()).handlers.onFrame({ t: "ready", n, ...extra });
    },
    now() {
      return nowMs;
    },
    ofType<T extends AudioClientFrame["t"]>(type: T) {
      return textFrames.filter((frame): frame is Extract<AudioClientFrame, { t: T }> => frame.t === type);
    },
  };
}

export const CREDS = { roomId: "abcdefgh", hostKey: "f".repeat(32) };
