import { describe, expect, it } from "vitest";
import { BITRATE, CHANNELS, createCaptureEncoder, OPUS_SAMPLE_RATE, type CaptureStatus, type EncodedPacket } from "../src/renderer/windows/media-host/encoder";

type Init = { output(chunk: { byteLength: number; timestamp: number; copyTo(target: ArrayBuffer): void }): void; error(error: unknown): void };

function harness(options: { failEncode?: boolean } = {}) {
  const encoders: FakeEncoder[] = [];
  const frames: { timestamp: number; sampleRate: number; numberOfFrames: number; data: Float32Array; closed: boolean }[] = [];
  const packets: EncodedPacket[][] = [];
  const statuses: CaptureStatus[] = [];

  class FakeEncoder {
    state = "unconfigured";
    config: Record<string, unknown> | null = null;
    constructor(readonly init: Init) {
      encoders.push(this);
    }
    configure(config: Record<string, unknown>) {
      this.config = config;
      this.state = "configured";
    }
    encode(frame: { timestamp: number }) {
      if (options.failEncode) throw new Error("encoder closed");
      this.init.output({ byteLength: 3, timestamp: frame.timestamp, copyTo: target => new Uint8Array(target).set([1, 2, 3]) });
    }
    close() {
      this.state = "closed";
    }
  }

  class FakeAudioData {
    closed = false;
    constructor(init: { timestamp: number; sampleRate: number; numberOfFrames: number; data: Float32Array }) {
      frames.push(Object.assign(this, init));
    }
    close() {
      this.closed = true;
    }
  }

  const encoder = createCaptureEncoder({
    api: { AudioEncoder: FakeEncoder as never, AudioData: FakeAudioData as never },
    sendPackets: batch => packets.push(batch),
    sendStatus: status => statuses.push(status)
  });
  return { encoder, encoders, frames, packets, statuses };
}

const chunk = (sampleRate = 48000, frames = 1024) => ({
  sampleRate,
  left: new Float32Array(frames).fill(0.25),
  right: new Float32Array(frames).fill(-0.5)
});

describe("media host capture encoder", () => {
  it("configures Opus at the page's sample rate and announces the stream as 48 kHz stereo", () => {
    const { encoder, encoders, statuses } = harness();

    encoder.push(chunk(44100));

    expect(encoders[0].config).toEqual({ codec: "opus", sampleRate: 44100, numberOfChannels: CHANNELS, bitrate: BITRATE });
    expect(statuses).toEqual([{ cfg: { sr: OPUS_SAMPLE_RATE, ch: 2, br: BITRATE } }]);
  });

  it("feeds planar frames on a timeline that only advances with the audio it received", () => {
    const { encoder, frames } = harness();

    encoder.push(chunk());
    encoder.push(chunk());
    encoder.push(chunk());

    expect(frames.map(frame => frame.timestamp)).toEqual([0, 21333, 42667]);
    expect(frames[0].data.slice(1022, 1026)).toEqual(new Float32Array([0.25, 0.25, -0.5, -0.5]));
    expect(frames.every(frame => frame.closed)).toBe(true);
  });

  it("starts a fresh encoder when the sample rate changes, without restarting the timeline", () => {
    const { encoder, encoders, frames } = harness();

    encoder.push(chunk(48000));
    encoder.push(chunk(44100));

    expect(encoders).toHaveLength(2);
    expect(encoders[0].state).toBe("closed");
    expect(frames[1].timestamp).toBe(21333);
  });

  it("hands over everything encoded since the last flush, and nothing when idle", () => {
    const { encoder, packets } = harness();

    encoder.flush();
    encoder.push(chunk());
    encoder.push(chunk());
    encoder.flush();
    encoder.flush();

    expect(packets).toHaveLength(1);
    expect(packets[0].map(packet => packet.t)).toEqual([0, 21333]);
    expect(Array.from(new Uint8Array(packets[0][0].d))).toEqual([1, 2, 3]);
  });

  it("reports a failure once and stops encoding", () => {
    const { encoder, statuses, frames } = harness({ failEncode: true });

    encoder.push(chunk());
    encoder.push(chunk());

    expect(statuses.filter(status => status.error)).toEqual([{ error: "Error: encoder closed" }]);
    expect(frames).toHaveLength(1);
  });
});
