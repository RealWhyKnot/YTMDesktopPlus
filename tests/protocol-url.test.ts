import { describe, expect, it } from "vitest";
import { parseProtocolUrl, resolveStartSeconds } from "../src/shared/protocol-url";

describe("parseProtocolUrl", () => {
  it("passes a command through with its segments in both written forms", () => {
    expect(parseProtocolUrl("ytmdplus://room/abcdefgh")).toMatchObject({ name: "room", segments: ["abcdefgh"] });
    expect(parseProtocolUrl("ytmdplus:room/abcdefgh")).toMatchObject({ name: "room", segments: ["abcdefgh"] });
  });

  it("keeps query params available to the handler", () => {
    const parsed = parseProtocolUrl("ytmdplus://room/abcdefgh?invite=yes");
    expect(parsed?.params.get("invite")).toBe("yes");
  });

  // ytmdplus: is a non-special scheme, so the host keeps its case.
  it("lowercases the command name but not the segments", () => {
    expect(parseProtocolUrl("ytmdplus://ROOM/ABCDEFGH")).toMatchObject({ name: "room", segments: ["ABCDEFGH"] });
  });

  it("drops empty path segments", () => {
    expect(parseProtocolUrl("ytmdplus://room/abcdefgh/")).toMatchObject({ segments: ["abcdefgh"] });
    expect(parseProtocolUrl("ytmdplus://room//abcdefgh")).toMatchObject({ segments: ["abcdefgh"] });
  });

  it("decodes percent-encoded segments", () => {
    expect(parseProtocolUrl("ytmdplus://room/abc%2Ddef")).toMatchObject({ segments: ["abc-def"] });
  });

  it("rejects anything it cannot act on", () => {
    expect(parseProtocolUrl("https://evil.com/room/abcdefgh")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://room/abc%")).toBeNull();
    expect(parseProtocolUrl("ytmdplus://")).toBeNull();
    expect(parseProtocolUrl("not a url")).toBeNull();
    expect(parseProtocolUrl("")).toBeNull();
  });

  // URL parsing collapses "..", so a traversal attempt just yields segments
  // the handler will reject. Handlers validate their own segments.
  it("collapses relative segments", () => {
    expect(parseProtocolUrl("ytmdplus://room/../../etc/passwd")).toMatchObject({ name: "room", segments: ["etc", "passwd"] });
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
