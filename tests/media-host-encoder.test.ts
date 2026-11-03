import { requireValue } from "./helpers/require-value";
import { describe, expect, it, vi } from "vitest";
import {
  BITRATE,
  CHANNELS,
  createCaptureEncoder,
  createUplink,
  OPUS_SAMPLE_RATE,
  type CaptureStatus,
  type EncodedPacket,
} from "../src/renderer/windows/media-host/encoder";

type Init = AudioEncoderInit;

function harness(options: { failEncode?: boolean } = {}) {
  const encoders: FakeEncoder[] = [];
  const frames: { timestamp: number; sampleRate: number; numberOfFrames: number; data: Float32Array; isClosed: boolean }[] = [];
  const packets: EncodedPacket[][] = [];
  const statuses: CaptureStatus[] = [];

  class FakeEncoder {
    state: CodecState = "unconfigured";
    config: AudioEncoderConfig | null = null;
    readonly init: Init;
    constructor(init: Init) {
      this.init = init;

      encoders.push(this);
    }
    configure(config: AudioEncoderConfig) {
      this.config = config;
      this.state = "configured";
    }
    encode(frame: { timestamp: number }) {
      if (options.failEncode) throw new Error("encoder closed");
      this.init.output({
        type: "key",
        duration: null,
        byteLength: 3,
        timestamp: frame.timestamp,
        copyTo: (target) => {
          const bytes = ArrayBuffer.isView(target) ? new Uint8Array(target.buffer, target.byteOffset, target.byteLength) : new Uint8Array(target);
          bytes.set([1, 2, 3]);
        },
      });
    }
    close() {
      this.state = "closed";
    }
  }

  class FakeAudioData {
    isClosed = false;
    readonly timestamp: number;
    readonly sampleRate: number;
    readonly numberOfFrames: number;
    readonly numberOfChannels: number;
    readonly format: AudioSampleFormat;
    readonly duration: number;
    constructor(init: AudioDataInit) {
      this.timestamp = init.timestamp;
      this.sampleRate = init.sampleRate;
      this.numberOfFrames = init.numberOfFrames;
      this.numberOfChannels = init.numberOfChannels;
      this.format = init.format;
      this.duration = (init.numberOfFrames / init.sampleRate) * 1e6;
      if (!(init.data instanceof Float32Array)) throw new TypeError("Expected planar float samples");
      frames.push(Object.assign(this, { data: init.data }));
    }
    allocationSize(): number {
      throw new Error("Unexpected audio allocation");
    }
    clone(): AudioData {
      throw new Error("Unexpected audio clone");
    }
    copyTo(): void {
      throw new Error("Unexpected audio copy");
    }
    close() {
      this.isClosed = true;
    }
  }

  const encoder = createCaptureEncoder({
    api: { AudioEncoder: FakeEncoder, AudioData: FakeAudioData },
    sendPackets: (batch) => packets.push(batch),
    sendStatus: (status) => statuses.push(status),
  });
  return { encoder, encoders, frames, packets, statuses };
}

const chunk = (sampleRate = 48000, frames = 1024) => ({
  sampleRate,
  left: new Float32Array(frames).fill(0.25),
  right: new Float32Array(frames).fill(-0.5),
});

describe("media host capture encoder", () => {
  it("configures Opus at the page's sample rate and announces the stream as 48 kHz stereo", () => {
    const { encoder, encoders, statuses } = harness();

    encoder.push(chunk(44100));

    expect(requireValue(encoders[0]).config).toEqual({ codec: "opus", sampleRate: 44100, numberOfChannels: CHANNELS, bitrate: BITRATE });
    expect(statuses).toEqual([{ cfg: { sr: OPUS_SAMPLE_RATE, ch: 2, br: BITRATE } }]);
  });

  it("feeds planar frames on a timeline that only advances with the audio it received", () => {
    const { encoder, frames } = harness();

    encoder.push(chunk());
    encoder.push(chunk());
    encoder.push(chunk());

    expect(frames.map((frame) => frame.timestamp)).toEqual([0, 21333, 42667]);
    expect(requireValue(frames[0]).data.slice(1022, 1026)).toEqual(new Float32Array([0.25, 0.25, -0.5, -0.5]));
    expect(frames.every((frame) => frame.isClosed)).toBe(true);
  });

  it("starts a fresh encoder when the sample rate changes, without restarting the timeline", () => {
    const { encoder, encoders, frames } = harness();

    encoder.push(chunk(48000));
    encoder.push(chunk(44100));

    expect(encoders).toHaveLength(2);
    expect(requireValue(encoders[0]).state).toBe("closed");
    expect(requireValue(frames[1]).timestamp).toBe(21333);
  });

  it("hands over everything encoded since the last flush, and nothing when idle", () => {
    const { encoder, packets } = harness();

    encoder.flush();
    encoder.push(chunk());
    encoder.push(chunk());
    encoder.flush();
    encoder.flush();

    expect(packets).toHaveLength(1);
    expect(requireValue(packets[0]).map((packet) => packet.t)).toEqual([0, 21333]);
    expect(Array.from(new Uint8Array(requireValue(requireValue(packets[0])[0]).d))).toEqual([1, 2, 3]);
  });

  it("reports a failure once and stops encoding", () => {
    const { encoder, statuses, frames } = harness({ failEncode: true });

    encoder.push(chunk());
    encoder.push(chunk());

    expect(statuses.filter((status) => status.error)).toEqual([{ error: "Error: encoder closed" }]);
    expect(frames).toHaveLength(1);
  });
});

describe("media host uplink", () => {
  const port = () => ({ postMessage: vi.fn(), close: vi.fn() });
  const cfg: CaptureStatus = { cfg: { sr: 48000, ch: 2, br: 128000 } };

  it("posts packets and status as copies, without a transfer list, and drops them while no port is attached", () => {
    const uplink = createUplink();
    const packets = [{ t: 0, d: new ArrayBuffer(3) }];
    uplink.sendPackets(packets);

    const current = port();
    uplink.attach(current);
    uplink.sendPackets(packets);
    uplink.sendStatus({ error: "boom" });

    expect(current.postMessage.mock.calls).toEqual([[{ packets }], [{ status: { error: "boom" } }]]);
  });

  it("closes the port it replaces and replays the codec config to the new one", () => {
    const uplink = createUplink();
    const first = port();
    uplink.attach(first);
    uplink.sendStatus(cfg);

    const second = port();
    uplink.attach(second);

    expect(first.close).toHaveBeenCalled();
    expect(second.postMessage.mock.calls).toEqual([[{ status: cfg }]]);
  });

  it("replays a config sent before any port was attached", () => {
    const uplink = createUplink();
    uplink.sendStatus(cfg);

    const current = port();
    uplink.attach(current);

    expect(current.postMessage.mock.calls).toEqual([[{ status: cfg }]]);
  });
});
