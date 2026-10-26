import { describe, expect, it } from "vitest";

import {
  AUDIO_BATCH_VERSION,
  BATCH_FLAG_DISCONTINUITY,
  BATCH_HEADER_BYTES,
  MAX_BATCH_BYTES,
  PACKET_HEADER_BYTES,
  MAX_COVER_URL_LENGTH,
  audioUrlForRoom,
  encodeBatch,
  isCoverUrl,
  parseAudioServerFrame,
  sanitizeMetaText
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

  it("reads the server clock and protocol version from ready when the relay sends them", () => {
    expect(parseAudioServerFrame(JSON.stringify({ t: "ready", n: 0, c: 1_754_236_800_000, v: 2 }))).toEqual({ t: "ready", n: 0, c: 1_754_236_800_000, v: 2 });
    expect(parseAudioServerFrame(JSON.stringify({ t: "ready", n: 0, c: "soon", v: null }))).toEqual({ t: "ready", n: 0 });
  });

  it("rejects junk", () => {
    expect(parseAudioServerFrame("not json")).toBeNull();
    expect(parseAudioServerFrame(JSON.stringify({ t: "n", n: "many" }))).toBeNull();
    expect(parseAudioServerFrame(JSON.stringify({ t: "meta" }))).toBeNull();
  });
});

describe("cover urls", () => {
  it("accepts what the relay accepts", () => {
    expect(isCoverUrl("https://lh3.googleusercontent.com/abc=w544-h544-l90-rj")).toBe(true);
    expect(isCoverUrl("https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg?sqp=-oaymwE&rs=AOn4CLB%3D")).toBe(true);
    expect(isCoverUrl(`https://${"a".repeat(MAX_COVER_URL_LENGTH - "https://".length)}`)).toBe(true);
  });

  it("rejects what the relay would reject", () => {
    expect(isCoverUrl("http://i.ytimg.com/a.jpg")).toBe(false);
    expect(isCoverUrl("https://")).toBe(false);
    expect(isCoverUrl("https://i.ytimg.com/a b.jpg")).toBe(false);
    expect(isCoverUrl('https://i.ytimg.com/a"b.jpg')).toBe(false);
    expect(isCoverUrl("https://i.ytimg.com/(a).jpg")).toBe(false);
    expect(isCoverUrl("https://i.ytimg.com/caf\u00e9.jpg")).toBe(false);
    expect(isCoverUrl(`https://${"a".repeat(MAX_COVER_URL_LENGTH)}`)).toBe(false);
  });
});

describe("meta text", () => {
  it("cleans text the way the relay does", () => {
    expect(sanitizeMetaText("  Song\u0000 Title\u007f ")).toBe("Song Title");
    expect(sanitizeMetaText("\u0001\u0002")).toBeUndefined();
    expect(sanitizeMetaText(undefined)).toBeUndefined();
    expect(sanitizeMetaText("x".repeat(250))).toBe("x".repeat(200));
  });

  it("never splits a surrogate pair at the length limit", () => {
    const text = `${"x".repeat(199)}\u{1F3B5}`;
    expect(sanitizeMetaText(text)).toBe("x".repeat(199));
  });
});
