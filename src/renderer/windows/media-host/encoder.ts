export type CaptureChunk = { sampleRate: number; left: Float32Array; right: Float32Array };
export type EncodedPacket = { t: number; d: ArrayBuffer };
export type CaptureStatus = { cfg?: { sr: number; ch: number; br: number }; error?: string };

export const OPUS_SAMPLE_RATE = 48000;
export const CHANNELS = 2;
export const BITRATE = 128000;
export const FLUSH_MS = 100;

export type UplinkPort = { postMessage(message: unknown): void; close(): void };

export function createUplink() {
  let port: UplinkPort | null = null;
  let cfg: CaptureStatus | null = null;
  return {
    attach(next: UplinkPort) {
      port?.close();
      port = next;
      if (cfg) port.postMessage({ status: cfg });
    },
    sendPackets(packets: EncodedPacket[]) {
      port?.postMessage({ packets });
    },
    sendStatus(status: CaptureStatus) {
      if (status.cfg) cfg = status;
      port?.postMessage({ status });
    }
  };
}

export type EncoderApi = {
  AudioEncoder: new (init: AudioEncoderInit) => Pick<AudioEncoder, "configure" | "encode" | "close" | "state">;
  AudioData: new (init: AudioDataInit) => Pick<AudioData, "close">;
};

export function createCaptureEncoder(deps: { api: EncoderApi; sendPackets(packets: EncodedPacket[]): void; sendStatus(status: CaptureStatus): void }) {
  let encoder: InstanceType<EncoderApi["AudioEncoder"]> | null = null;
  let sampleRate = 0;
  let clockUs = 0;
  let pending: EncodedPacket[] = [];
  let failed = false;

  const fail = (error: unknown) => {
    failed = true;
    deps.sendStatus({ error: String(error) });
  };

  const configure = (rate: number) => {
    if (encoder && encoder.state !== "closed") encoder.close();
    encoder = new deps.api.AudioEncoder({
      output: chunk => {
        const data = new ArrayBuffer(chunk.byteLength);
        chunk.copyTo(data);
        pending.push({ t: chunk.timestamp, d: data });
      },
      error: fail
    });
    encoder.configure({ codec: "opus", sampleRate: rate, numberOfChannels: CHANNELS, bitrate: BITRATE });
    sampleRate = rate;
    deps.sendStatus({ cfg: { sr: OPUS_SAMPLE_RATE, ch: CHANNELS, br: BITRATE } });
  };

  return {
    push(chunk: CaptureChunk) {
      if (failed) return;
      try {
        if (!encoder || chunk.sampleRate !== sampleRate) configure(chunk.sampleRate);
        const frames = chunk.left.length;
        const data = new Float32Array(frames * CHANNELS);
        data.set(chunk.left, 0);
        data.set(chunk.right, frames);
        const audio = new deps.api.AudioData({
          format: "f32-planar",
          sampleRate: chunk.sampleRate,
          numberOfFrames: frames,
          numberOfChannels: CHANNELS,
          timestamp: Math.round(clockUs),
          data
        });
        clockUs += (frames * 1e6) / chunk.sampleRate;
        try {
          encoder.encode(audio as AudioData);
        } finally {
          audio.close();
        }
      } catch (error) {
        fail(error);
      }
    },
    flush() {
      if (pending.length === 0) return;
      const packets = pending;
      pending = [];
      deps.sendPackets(packets);
    }
  };
}
