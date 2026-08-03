import { describe, expect, it } from "vitest";
import { buildListenAlongUrl, parseProtocolUrl, resolveStartSeconds } from "../src/shared/protocol-url";

describe("parseProtocolUrl", () => {
  it("parses the plain form", () => {
    expect(parseProtocolUrl("ytmdplus://play/dQw4w9WgXcQ")).toEqual({
      command: "play",
      videoId: "dQw4w9WgXcQ",
      playlistId: null,
      anchor: null
    });
  });

  it("parses a playlist path segment", () => {
    expect(parseProtocolUrl("ytmdplus://play/abc123/PLxyz")).toMatchObject({ videoId: "abc123", playlistId: "PLxyz" });
  });

  it("reads a playlist from the list param", () => {
    expect(parseProtocolUrl("ytmdplus://play/abc123?list=PLxyz")).toMatchObject({ playlistId: "PLxyz" });
  });

  it("reads a frozen position from t", () => {
    expect(parseProtocolUrl("ytmdplus://play/abc123?t=42")).toMatchObject({ anchor: { kind: "absolute", seconds: 42 } });
  });

  it("reads a live anchor from at", () => {
    expect(parseProtocolUrl("ytmdplus://play/abc123?at=1754236800000")).toMatchObject({ anchor: { kind: "anchor", epochMs: 1754236800000 } });
  });

  it("prefers at over t when both are present", () => {
    expect(parseProtocolUrl("ytmdplus://play/abc123?t=42&at=1754236800000")).toMatchObject({ anchor: { kind: "anchor", epochMs: 1754236800000 } });
  });

  it("ignores an unusable position instead of throwing", () => {
    expect(parseProtocolUrl("ytmdplus://play/abc123?t=abc")).toMatchObject({ videoId: "abc123", anchor: null });
    expect(parseProtocolUrl("ytmdplus://play/abc123?t=-5")).toMatchObject({ videoId: "abc123", anchor: null });
    expect(parseProtocolUrl("ytmdplus://play/abc123?at=nope")).toMatchObject({ videoId: "abc123", anchor: null });
  });

  // ytmdplus: is a non-special scheme, so the host keeps its case.
  it("normalizes the command case", () => {
    expect(parseProtocolUrl("ytmdplus://PLAY/abc123")).toMatchObject({ command: "play", videoId: "abc123" });
  });

  // Without "//" there is no host and the command lands in the path.
  it("parses the form written without an authority", () => {
    expect(parseProtocolUrl("ytmdplus:play/abc123")).toMatchObject({ command: "play", videoId: "abc123" });
  });

  it("drops empty path segments", () => {
    expect(parseProtocolUrl("ytmdplus://play/abc123/")).toMatchObject({ videoId: "abc123", playlistId: null });
    expect(parseProtocolUrl("ytmdplus://play//PLxyz")).toMatchObject({ videoId: "PLxyz", playlistId: null });
  });

  it("decodes percent-encoded segments", () => {
    expect(parseProtocolUrl("ytmdplus://play/abc%2Ddef")).toMatchObject({ videoId: "abc-def" });
  });

  it("rejects anything it cannot act on", () => {
    expect(parseProtocolUrl("https://evil.com/play/abc123")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://open/abc123")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://play")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://play/abc def")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://play/abc%")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://play/abc123/not a playlist")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://play/abc123/PLxyz/extra")).toBeNull();
    expect(parseProtocolUrl("not a url")).toBeNull();
    expect(parseProtocolUrl("")).toBeNull();
  });

  // URL parsing collapses "..", so a traversal attempt just yields ids that do
  // not exist. They are handed to YouTube Music as opaque strings, never used
  // as a path, so the track simply fails to load.
  it("collapses relative segments into harmless ids", () => {
    expect(parseProtocolUrl("ytmdplus://play/../../etc/passwd")).toMatchObject({ videoId: "etc", playlistId: "passwd" });
  });
});

describe("resolveStartSeconds", () => {
  const now = 1754236800000;

  it("advances a live anchor by the time since it was written", () => {
    expect(resolveStartSeconds({ kind: "anchor", epochMs: now - 60_000 }, now, 200)).toBe(60);
  });

  it("takes a frozen position as-is", () => {
    expect(resolveStartSeconds({ kind: "absolute", seconds: 42 }, now, 200)).toBe(42);
  });

  it("plays from the start when there is no anchor", () => {
    expect(resolveStartSeconds(null, now, 200)).toBeNull();
  });

  it("plays from the start when the anchor has run past the track", () => {
    expect(resolveStartSeconds({ kind: "anchor", epochMs: now - 60_000 }, now, 50)).toBeNull();
    expect(resolveStartSeconds({ kind: "absolute", seconds: 500 }, now, 200)).toBeNull();
  });

  it("plays from the start rather than seeking into the outro", () => {
    expect(resolveStartSeconds({ kind: "absolute", seconds: 197 }, now, 200)).toBeNull();
  });

  it("skips a seek that is not worth the stutter", () => {
    expect(resolveStartSeconds({ kind: "anchor", epochMs: now - 2000 }, now, 200)).toBeNull();
  });

  // A future anchor means the two clocks disagree; do not seek backwards.
  it("ignores a future anchor", () => {
    expect(resolveStartSeconds({ kind: "anchor", epochMs: now + 60_000 }, now, 200)).toBeNull();
  });

  it("accepts a frozen position when the duration is unknown", () => {
    expect(resolveStartSeconds({ kind: "absolute", seconds: 42 }, now, null)).toBe(42);
    expect(resolveStartSeconds({ kind: "absolute", seconds: 42 }, now, 0)).toBe(42);
  });
});

describe("buildListenAlongUrl", () => {
  const now = 1754236800000;
  const base = { videoId: "abc123", durationSeconds: 200, isLive: false, adPlaying: false, nowMs: now };

  it("anchors to wall clock while playing", () => {
    expect(buildListenAlongUrl({ ...base, positionSeconds: 60, playing: true })).toBe(`ytmdplus://play/abc123?at=${now - 60_000}`);
  });

  it("freezes the position while paused", () => {
    expect(buildListenAlongUrl({ ...base, positionSeconds: 60, playing: false })).toBe("ytmdplus://play/abc123?t=60");
  });

  it("includes a playlist when there is one", () => {
    expect(buildListenAlongUrl({ ...base, playlistId: "PLxyz", positionSeconds: 60, playing: true })).toBe(`ytmdplus://play/abc123/PLxyz?at=${now - 60_000}`);
  });

  // Early in a track the link stays in the format older builds understand.
  it("omits the position near the start", () => {
    expect(buildListenAlongUrl({ ...base, positionSeconds: 2, playing: true })).toBe("ytmdplus://play/abc123");
  });

  it("omits the position when it does not describe the music", () => {
    expect(buildListenAlongUrl({ ...base, positionSeconds: 60, playing: true, adPlaying: true })).toBe("ytmdplus://play/abc123");
    expect(buildListenAlongUrl({ ...base, positionSeconds: 60, playing: true, isLive: true })).toBe("ytmdplus://play/abc123");
    expect(buildListenAlongUrl({ ...base, positionSeconds: 60, playing: true, durationSeconds: 0 })).toBe("ytmdplus://play/abc123");
  });

  it("stays well inside Discord's button url limit", () => {
    const url = buildListenAlongUrl({ ...base, videoId: "a".repeat(64), playlistId: "b".repeat(128), positionSeconds: 60, playing: true });
    expect(url.length).toBeLessThan(512);
  });

  it("round-trips through the parser", () => {
    const url = buildListenAlongUrl({ ...base, playlistId: "PLxyz", positionSeconds: 60, playing: true });
    expect(parseProtocolUrl(url)).toEqual({
      command: "play",
      videoId: "abc123",
      playlistId: "PLxyz",
      anchor: { kind: "anchor", epochMs: now - 60_000 }
    });
  });

  it("resolves a freshly built link back to the position it encoded", () => {
    const url = buildListenAlongUrl({ ...base, positionSeconds: 60, playing: true });
    const parsed = parseProtocolUrl(url);
    expect(resolveStartSeconds(parsed.anchor, now, 200)).toBe(60);
  });
});

describe("room links", () => {
  it("parses a room link in both written forms", () => {
    expect(parseProtocolUrl("ytmdplus://room/abcdefgh")).toEqual({ command: "room", roomId: "abcdefgh" });
    expect(parseProtocolUrl("ytmdplus:room/abcdefgh")).toEqual({ command: "room", roomId: "abcdefgh" });
  });

  it("rejects malformed room ids", () => {
    expect(parseProtocolUrl("ytmdplus://room/ABCDEFGH")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://room/abcdefg1")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://room/short")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://room/abcdefgh/extra")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://room")).toBeNull();
  });
});
