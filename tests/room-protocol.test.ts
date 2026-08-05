import { describe, expect, it } from "vitest";
import {
  anchorFrameFrom,
  buildRoomShareUrl,
  encodeClientFrame,
  isFatalRelayError,
  isMeaningfulChange,
  isRoomId,
  isRoomLive,
  otherListenerCount,
  parseServerFrame,
  positionMsFrom,
  sanitizeDisplayName,
  type RoomSnapshot
} from "../src/shared/room-protocol";

describe("parseServerFrame", () => {
  it("parses a ready frame with and without a host key", () => {
    expect(parseServerFrame('{"t":"r","r":"abcdefgh","k":"' + "a".repeat(32) + '","u":"abcdef","role":0,"n":0,"c":123}')).toEqual({
      t: "r",
      r: "abcdefgh",
      k: "a".repeat(32),
      u: "abcdef",
      role: 0,
      n: 0,
      c: 123
    });
    expect(parseServerFrame('{"t":"r","r":"abcdefgh","u":"abcdef","role":1,"n":3,"c":123}')).toMatchObject({ t: "r", role: 1, n: 3 });
  });

  it("parses state, roster, role, control, count and error frames", () => {
    expect(parseServerFrame('{"t":"s","v":"dQw4w9WgXcQ","a":1,"p":1,"c":2}')).toEqual({ t: "s", v: "dQw4w9WgXcQ", a: 1, p: 1, c: 2 });
    expect(parseServerFrame('{"t":"m","members":[{"u":"abcdef","r":1,"d":"Alice"}],"h":"DJ"}')).toEqual({
      t: "m",
      members: [{ u: "abcdef", r: 1, d: "Alice" }],
      h: "DJ"
    });
    expect(parseServerFrame('{"t":"role","r":1}')).toEqual({ t: "role", r: 1 });
    expect(parseServerFrame('{"t":"c","a":"seek","m":42,"u":"abcdef"}')).toEqual({ t: "c", a: "seek", m: 42, u: "abcdef" });
    expect(parseServerFrame('{"t":"c","a":"track","v":"dQw4w9WgXcQ","u":"abcdef"}')).toEqual({ t: "c", a: "track", v: "dQw4w9WgXcQ", u: "abcdef" });
    expect(parseServerFrame('{"t":"n","n":5}')).toEqual({ t: "n", n: 5 });
    expect(parseServerFrame('{"t":"e","m":"room full"}')).toEqual({ t: "e", m: "room full" });
  });

  it("rejects malformed frames without throwing", () => {
    expect(parseServerFrame("junk")).toBeNull();
    expect(parseServerFrame("null")).toBeNull();
    expect(parseServerFrame('{"t":"r","r":"BADROOM!","u":"abcdef","role":0,"n":0,"c":1}')).toBeNull();
    expect(parseServerFrame('{"t":"m","members":[{"u":"abcdef","r":7}]}')).toBeNull();
    expect(parseServerFrame('{"t":"c","a":"seek","u":"abcdef"}')).toBeNull();
    expect(parseServerFrame('{"t":"s","v":"bad id","a":1,"p":1,"c":1}')).toBeNull();
    expect(parseServerFrame('{"t":"e","m":' + JSON.stringify("x".repeat(300)) + "}")).toBeNull();
  });
});

describe("anchors", () => {
  const now = 1754236800000;

  it("round-trips a playing anchor", () => {
    const frame = anchorFrameFrom("dQw4w9WgXcQ", 42, true, now);
    expect(frame).toEqual({ t: "s", v: "dQw4w9WgXcQ", a: now - 42_000, p: 1 });
    expect(positionMsFrom(frame, now)).toBe(42_000);
    expect(positionMsFrom(frame, now + 10_000)).toBe(52_000);
  });

  it("round-trips a paused anchor", () => {
    const frame = anchorFrameFrom("dQw4w9WgXcQ", 42, false, now);
    expect(frame).toEqual({ t: "s", v: "dQw4w9WgXcQ", a: 42_000, p: 0 });
    expect(positionMsFrom(frame, now + 99_000)).toBe(42_000);
  });

  it("suppresses steady playback and reports seeks", () => {
    const first = anchorFrameFrom("dQw4w9WgXcQ", 42, true, now);
    const drifting = anchorFrameFrom("dQw4w9WgXcQ", 42.4, true, now + 400);
    expect(isMeaningfulChange(first, drifting)).toBe(false);
    const seeked = anchorFrameFrom("dQw4w9WgXcQ", 90, true, now + 400);
    expect(isMeaningfulChange(first, seeked)).toBe(true);
    expect(isMeaningfulChange(first, anchorFrameFrom("dQw4w9WgXcQ", 42, false, now))).toBe(true);
    expect(isMeaningfulChange(null, first)).toBe(true);
  });
});

describe("helpers", () => {
  it("validates room ids", () => {
    expect(isRoomId("abcdefgh")).toBe(true);
    expect(isRoomId("ABCDEFGH")).toBe(false);
    expect(isRoomId("abcdefg1")).toBe(false);
    expect(isRoomId("short")).toBe(false);
  });

  it("sanitizes display names like the relay does", () => {
    expect(sanitizeDisplayName("  Alice ")).toBe("Alice");
    expect(sanitizeDisplayName("Ali\u0000ce")).toBe("Alice");
    expect(sanitizeDisplayName("x".repeat(40))).toHaveLength(24);
    expect(sanitizeDisplayName("  ")).toBeUndefined();
  });

  it("knows which relay errors are fatal", () => {
    expect(isFatalRelayError("room closed")).toBe(true);
    expect(isFatalRelayError("not a controller")).toBe(false);
  });

  it("builds share urls and encodes frames", () => {
    expect(buildRoomShareUrl("abcdefgh")).toBe("https://ytmdesktopplus.com/r/abcdefgh");
    expect(encodeClientFrame({ t: "j", r: "abcdefgh", d: "Alice" })).toBe('{"t":"j","r":"abcdefgh","d":"Alice"}');
  });
});

function snapshot(fields: Partial<RoomSnapshot>): RoomSnapshot {
  return { phase: "hosting", isHost: true, listenerCount: 0, webListenerCount: 0, ...fields } as RoomSnapshot;
}

describe("room indicator counts", () => {
  it("is live only once the room is up", () => {
    expect(isRoomLive(null)).toBe(false);
    expect(isRoomLive(snapshot({ phase: "idle" }))).toBe(false);
    expect(isRoomLive(snapshot({ phase: "connecting" }))).toBe(false);
    expect(isRoomLive(snapshot({ phase: "failed" }))).toBe(false);
    expect(isRoomLive(snapshot({ phase: "hosting" }))).toBe(true);
    expect(isRoomLive(snapshot({ phase: "listening" }))).toBe(true);
  });

  it("counts nobody while the room is not live", () => {
    expect(otherListenerCount(null)).toBe(0);
    expect(otherListenerCount(snapshot({ phase: "connecting", listenerCount: 3 }))).toBe(0);
  });

  it("counts app and browser listeners for a host", () => {
    expect(otherListenerCount(snapshot({}))).toBe(0);
    expect(otherListenerCount(snapshot({ listenerCount: 2 }))).toBe(2);
    expect(otherListenerCount(snapshot({ listenerCount: 2, webListenerCount: 3 }))).toBe(5);
  });

  it("counts the host for a listener", () => {
    expect(otherListenerCount(snapshot({ phase: "listening", isHost: false }))).toBe(1);
    expect(otherListenerCount(snapshot({ phase: "listening", isHost: false, listenerCount: 2 }))).toBe(3);
  });
});
