import { describe, expect, it } from "vitest";
import { extractDurationSeconds, extractHistoryHead } from "../src/addons/bundled/mobile-bridge/history-parse";

function row(videoId: string | null, title: string, options: { author?: string; thumbnails?: { url: string }[]; fixedText?: string } = {}) {
  return {
    musicResponsiveListItemRenderer: {
      playlistItemData: videoId ? { videoId } : undefined,
      flexColumns: [
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: title }] } } },
        { musicResponsiveListItemFlexColumnRenderer: { text: { runs: [{ text: options.author ?? "Artist" }] } } }
      ],
      fixedColumns: options.fixedText ? [{ musicResponsiveListItemFixedColumnRenderer: { text: { runs: [{ text: options.fixedText }] } } }] : undefined,
      thumbnail: options.thumbnails ? { musicThumbnailRenderer: { thumbnail: { thumbnails: options.thumbnails } } } : undefined
    }
  };
}

describe("extractHistoryHead", () => {
  it("walks nested containers and reads columns, thumbnail and duration", () => {
    const response = {
      contents: { deeply: [{ nested: [row("vid1", "Song One", { fixedText: "3:45", thumbnails: [{ url: "small" }, { url: "large" }] })] }] }
    };

    expect(extractHistoryHead(response)).toEqual([{ videoId: "vid1", title: "Song One", author: "Artist", thumbnailUrl: "large", durationSeconds: 225 }]);
  });

  it("parses hour-long durations and treats other fixed text as none", () => {
    const items = extractHistoryHead({
      contents: [row("a", "Long", { fixedText: "1:02:03" }), row("b", "Odd", { fixedText: "not a duration" })]
    });
    expect(items.map(item => item.durationSeconds)).toEqual([3723, null]);
  });

  it("skips rows without a video id and stops at the limit", () => {
    const items = extractHistoryHead(
      {
        contents: [row(null, "Ghost"), row("one", "One"), row("two", "Two"), row("three", "Three")]
      },
      2
    );
    expect(items.map(item => item.videoId)).toEqual(["one", "two"]);
  });

  it("returns nothing for shapes it does not recognize", () => {
    expect(extractHistoryHead(null)).toEqual([]);
    expect(extractHistoryHead({ some: { other: "shape" } })).toEqual([]);
  });
});

describe("extractDurationSeconds", () => {
  it("reads a usable length and rejects the rest", () => {
    expect(extractDurationSeconds({ videoDetails: { lengthSeconds: "213" } })).toBe(213);
    expect(extractDurationSeconds({ videoDetails: { lengthSeconds: "0" } })).toBeNull();
    expect(extractDurationSeconds({ videoDetails: {} })).toBeNull();
    expect(extractDurationSeconds({})).toBeNull();
    expect(extractDurationSeconds(null)).toBeNull();
  });
});
