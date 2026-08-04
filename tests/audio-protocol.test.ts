import { describe, expect, it } from "vitest";

import {
  AUDIO_BATCH_VERSION,
  BATCH_FLAG_DISCONTINUITY,
  BATCH_HEADER_BYTES,
  MAX_BATCH_BYTES,
  PACKET_HEADER_BYTES,
  audioUrlForRoom,
  encodeBatch,
  parseAudioServerFrame
} from "../src/shared/audio-protocol";

describe("audio urls", () => {
  it("routes through the edge by room id", () => {
    expect(audioUrlForRoom("abcdefgh")).toBe("wss://ytmdesktopplus.com/audio/abcdefgh");
  });
});

describe("batch encoding", () => {
  it("lays packets out exactly as the relay reads them", () => {
    const wire = encodeBatch(
      [
        { timestampUs: 1_000_000, payload: new Uint8Array([1, 2, 3]) },
        { timestampUs: 1_020_000, payload: new Uint8Array([4, 5]) }
      ],
      42,
      { discontinuity: true }
    );

    const view = new DataView(wire.buffer);
    expect(view.getUint8(0)).toBe(AUDIO_BATCH_VERSION);
    expect(view.getUint8(1)).toBe(BATCH_FLAG_DISCONTINUITY);
    expect(view.getUint16(2)).toBe(2);
    expect(view.getUint32(4)).toBe(42);
    expect(view.getFloat64(8)).toBe(1_000_000);

    expect(view.getUint32(BATCH_HEADER_BYTES)).toBe(0);
    expect(view.getUint16(BATCH_HEADER_BYTES + 4)).toBe(3);
    const second = BATCH_HEADER_BYTES + PACKET_HEADER_BYTES + 3;
    expect(view.getUint32(second)).toBe(20_000);
    expect(view.getUint16(second + 4)).toBe(2);
    expect([...wire.slice(second + PACKET_HEADER_BYTES)]).toEqual([4, 5]);
  });

  it("refuses empty and oversized batches", () => {
    expect(() => encodeBatch([], 1)).toThrow();
    expect(() => encodeBatch([{ timestampUs: 0, payload: new Uint8Array(MAX_BATCH_BYTES) }], 1)).toThrow();
    expect(() =>
      encodeBatch(
        [
          { timestampUs: 5, payload: new Uint8Array(1) },
          { timestampUs: 0, payload: new Uint8Array(1) }
        ],
        1
      )
    ).toThrow();
  });
});

describe("server frames", () => {
  it("parses what a publisher can receive", () => {
    expect(parseAudioServerFrame(JSON.stringify({ t: "ready", n: 3 }))).toEqual({ t: "ready", n: 3 });
    expect(parseAudioServerFrame(JSON.stringify({ t: "n", n: 5 }))).toEqual({ t: "n", n: 5 });
    expect(parseAudioServerFrame(JSON.stringify({ t: "e", m: "bad key" }))).toEqual({ t: "e", m: "bad key" });
  });

  it("rejects junk", () => {
    expect(parseAudioServerFrame("not json")).toBeNull();
    expect(parseAudioServerFrame(JSON.stringify({ t: "n", n: "many" }))).toBeNull();
    expect(parseAudioServerFrame(JSON.stringify({ t: "meta" }))).toBeNull();
  });
});
