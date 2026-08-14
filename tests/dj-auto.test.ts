import { describe, expect, it } from "vitest";
import { resolveNextTrack } from "../src/addons/bundled/dj/auto-dj";
import { RepeatMode, type PlayerQueue, type PlayerQueueItem } from "../src/shared/addons/sdk";

function item(videoId: string): PlayerQueueItem {
  return { videoId, title: `title of ${videoId}`, author: "someone", duration: "3:20", thumbnails: [], selected: false, counterparts: null };
}

function queueOf(items: PlayerQueueItem[], automixItems: PlayerQueueItem[] = [], selectedItemIndex = 0): PlayerQueue {
  return { items, automixItems, autoplay: false, isGenerating: false, isInfinite: false, repeatMode: RepeatMode.None, selectedItemIndex };
}

describe("dj next track", () => {
  it("returns null with no queue and nothing ahead", () => {
    expect(resolveNextTrack(null)).toBeNull();
    expect(resolveNextTrack(queueOf([item("only")], [], 0))).toBeNull();
  });

  it("takes the following queue entry, whatever its tempo", () => {
    const queue = queueOf([item("a"), item("b"), item("c")], [], 1);
    expect(resolveNextTrack(queue)).toEqual({ videoId: "c", title: "title of c" });
  });

  it("falls through to the first automix suggestion once the queue runs out", () => {
    const queue = queueOf([item("a")], [item("radio1"), item("radio2")], 0);
    expect(resolveNextTrack(queue)).toEqual({ videoId: "radio1", title: "title of radio1" });
  });
});
