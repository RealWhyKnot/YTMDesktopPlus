import { requireValue } from "./helpers/require-value";
import { describe, expect, it } from "vitest";

import {
  MAX_LINE_LENGTH,
  MAX_LINES,
  cleanArtist,
  cleanTitle,
  fromYtmTimed,
  parseLrc,
  pickLrclib,
  plainLines,
  textMatch,
  type LrclibRecord,
} from "../src/addons/bundled/lyrics/lyrics-data";

const VERSE = ["I walked along the river", "the water running cold", "you said the night was ours", "and never let it go", "we sang until the morning"];

function lrc(lines: string[], step = 4000, from = 10000) {
  return lines
    .map((line, index) => {
      const ms = from + index * step;
      const minutes = Math.floor(ms / 60000);
      const seconds = ((ms % 60000) / 1000).toFixed(2).padStart(5, "0");
      return `[${String(minutes).padStart(2, "0")}:${seconds}]${line}`;
    })
    .join("\n");
}

function record(overrides: Partial<LrclibRecord> = {}): LrclibRecord {
  return {
    id: 1,
    trackName: "River",
    artistName: "Someone",
    duration: 200,
    instrumental: false,
    plainLyrics: VERSE.join("\n"),
    syncedLyrics: lrc(VERSE),
    ...overrides,
  };
}

describe("parseLrc", () => {
  it("reads timestamps and ends each line where the next begins", () => {
    const lines = parseLrc("[00:01.50]one\n[00:03.25]two\n[01:00]three");
    expect(lines).toEqual([
      { text: "one", start: 1500, end: 3250 },
      { text: "two", start: 3250, end: 60000 },
      { text: "three", start: 60000, end: null },
    ]);
  });

  it("repeats a line that carries several timestamps and keeps time order", () => {
    const lines = parseLrc("[00:20.00][00:05.00]chorus\n[00:10.00]verse");
    expect(lines.map((line) => [line.text, line.start])).toEqual([
      ["chorus", 5000],
      ["verse", 10000],
      ["chorus", 20000],
    ]);
  });

  it("applies the offset tag and never goes below zero", () => {
    const lines = parseLrc("[offset:+500]\n[00:00.20]early\n[00:02.00]later");
    expect(lines.map((line) => line.start)).toEqual([0, 1500]);
  });

  it("keeps blank timed lines as instrumental breaks and skips metadata", () => {
    const lines = parseLrc("[ar:Someone]\n[ti:River]\n[00:01.00]sung\n[00:04.00]\n[00:09.00]back");
    expect(lines.map((line) => line.text)).toEqual(["sung", "", "back"]);
  });

  it("reads per-word timings from enhanced LRC", () => {
    const [line] = parseLrc("[00:10.00]<00:10.00>hold <00:10.50>me <00:11.20>close");
    expect(requireValue(line).text).toBe("hold me close");
    expect(requireValue(line).words).toEqual([
      { text: "hold", start: 10000 },
      { text: "me", start: 10500 },
      { text: "close", start: 11200 },
    ]);
  });

  it("caps the line count and the line length", () => {
    const many = Array.from({ length: MAX_LINES + 50 }, (_, index) => `[00:${String(index % 60).padStart(2, "0")}.00]x`).join("\n");
    expect(parseLrc(many)).toHaveLength(MAX_LINES);
    const [long] = parseLrc(`[00:01.00]${"a".repeat(MAX_LINE_LENGTH * 3)}`);
    expect(requireValue(long).text).toHaveLength(MAX_LINE_LENGTH);
  });
});

describe("fromYtmTimed", () => {
  it("maps cue ranges to timed lines", () => {
    const lyrics = fromYtmTimed([
      { lyricLine: "first", cueRange: { startTimeMilliseconds: "1000", endTimeMilliseconds: "2500" } },
      { lyricLine: "second", cueRange: { startTimeMilliseconds: "2500", endTimeMilliseconds: "4000" } },
    ]);
    expect(lyrics).toEqual({
      timed: true,
      source: "",
      lines: [
        { text: "first", start: 1000, end: 2500 },
        { text: "second", start: 2500, end: 4000 },
      ],
    });
  });

  it("drops all timing when any line lacks a cue range", () => {
    const lyrics = fromYtmTimed([{ lyricLine: "first", cueRange: { startTimeMilliseconds: "1000" } }, { lyricLine: "second" }]);
    expect(lyrics?.timed).toBe(false);
    expect(lyrics?.lines.every((line) => line.start === null && line.end === null)).toBe(true);
  });

  it("returns null for nothing and tolerates junk entries", () => {
    expect(fromYtmTimed([])).toBeNull();
    expect(fromYtmTimed(null)).toBeNull();
    expect(requireValue(fromYtmTimed([{ lyricLine: 5 }])?.lines[0]).text).toBe("");
  });
});

describe("plainLines", () => {
  it("splits text into untimed lines and collapses whitespace", () => {
    expect(plainLines("a  b\r\n\nc")).toEqual([
      { text: "a b", start: null, end: null },
      { text: "", start: null, end: null },
      { text: "c", start: null, end: null },
    ]);
  });
});

describe("textMatch", () => {
  it("scores shared words regardless of case, accents and punctuation", () => {
    expect(textMatch("Café, NOCHE!", "cafe noche")).toBe(1);
    expect(textMatch("one two three four", "one two")).toBe(0.5);
    expect(textMatch("", "anything")).toBe(0);
  });
});

describe("title and artist cleanup", () => {
  it.each([
    ["River (Official Video)", "River"],
    ["River [Lyrics]", "River"],
    ["River (Remastered 2011)", "River"],
    ["River | Live at Home", "River"],
    ["River (feat. Someone Else)", "River (feat. Someone Else)"],
  ])("cleans %s", (title, expected) => {
    expect(cleanTitle(title)).toBe(expected);
  });

  it.each([
    ["Someone - Topic", "Someone"],
    ["SomeoneVEVO", "Someone"],
    ["Someone & Another", "Someone"],
    ["Someone feat. Another", "Someone"],
    ["Someone, Another", "Someone"],
  ])("cleans %s", (artist, expected) => {
    expect(cleanArtist(artist)).toBe(expected);
  });
});

describe("pickLrclib", () => {
  const target = { durationSeconds: 200, referenceText: VERSE.join("\n") };

  it("takes a synced record whose length and words match", () => {
    const picked = pickLrclib([record()], target);
    expect(picked?.timed).toBe(true);
    expect(picked?.lines.map((line) => line.text)).toEqual(VERSE);
  });

  it("rejects a record more than two seconds off the track length", () => {
    expect(pickLrclib([record({ duration: 203 })], target)).toBeNull();
    expect(pickLrclib([record({ duration: 202 })], target)).not.toBeNull();
  });

  it("rejects lyrics for a different song", () => {
    const other = ["completely unrelated words here", "nothing alike at all", "different song entirely", "more filler text", "end of it"];
    expect(pickLrclib([record({ syncedLyrics: lrc(other) })], target)).toBeNull();
  });

  it("skips instrumentals, plain-only records and timings past the end", () => {
    expect(pickLrclib([record({ instrumental: true })], target)).toBeNull();
    expect(pickLrclib([record({ syncedLyrics: null })], target)).toBeNull();
    expect(pickLrclib([record({ syncedLyrics: lrc(VERSE, 60000) })], target)).toBeNull();
  });

  it("prefers the closest match when several pass", () => {
    const partial = record({ id: 2, syncedLyrics: lrc([...VERSE.slice(0, 4), "a line that is not in the song"]) });
    expect(pickLrclib([partial, record({ id: 3 })], target)?.lines.at(-1)?.text).toBe(VERSE.at(-1));
  });

  it("without reference text, needs two records that agree unless only one exists", () => {
    const noReference = { durationSeconds: 200, referenceText: null as string | null };
    const other = ["completely unrelated words here", "nothing alike at all", "different song entirely", "more filler text", "end of it"];
    expect(pickLrclib([record()], noReference)).not.toBeNull();
    expect(pickLrclib([record(), record({ id: 2, syncedLyrics: lrc(other) })], noReference)).toBeNull();
    expect(requireValue(pickLrclib([record(), record({ id: 2 }), record({ id: 3, syncedLyrics: lrc(other) })], noReference)?.lines[0]).text).toBe(VERSE[0]);
  });

  it("ignores junk input", () => {
    expect(pickLrclib(null, target)).toBeNull();
    expect(pickLrclib([null, { ...record(), duration: Number.NaN }], target)).toBeNull();
  });
});
