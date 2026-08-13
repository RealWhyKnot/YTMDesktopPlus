import path from "node:path";
import { describe, expect, it } from "vitest";
import { findQueueItemRenderer, libraryCandidates, pickNext } from "../src/addons/bundled/dj/auto-dj";
import { ANALYSIS_VERSION, FeatureDb } from "../src/addons/bundled/dj/feature-db";
import type { TrackFeatures } from "../src/addons/bundled/dj/scoring";
import { RepeatMode, type PlayerQueue, type PlayerQueueItem } from "../src/shared/addons/sdk";
import { makeVideoDetails } from "./helpers/fake-addon-context";
import { makeTempDir } from "./helpers/temp-dir";

function item(videoId: string, author = "someone"): PlayerQueueItem {
  return { videoId, title: `title of ${videoId}`, author, duration: "3:20", thumbnails: [], selected: false, counterparts: null };
}

function queueOf(items: PlayerQueueItem[], automixItems: PlayerQueueItem[] = [], selectedItemIndex = 0): PlayerQueue {
  return { items, automixItems, autoplay: false, isGenerating: false, isInfinite: false, repeatMode: RepeatMode.None, selectedItemIndex };
}

function features(videoId: string, overrides: Partial<TrackFeatures> = {}): TrackFeatures {
  return {
    videoId,
    title: `title of ${videoId}`,
    author: "someone",
    bpm: 128,
    bpmConfidence: 1,
    camelot: "8B",
    keyConfidence: 1,
    energy: 0.5,
    loudnessDb: null,
    durationS: 200,
    beatOffsetS: 0.2,
    analysisVersion: ANALYSIS_VERSION,
    analyzedAt: 0,
    ...overrides
  };
}

function db(): FeatureDb {
  return new FeatureDb(path.join(makeTempDir("dj-auto-"), "features.json"));
}

describe("dj auto pick", () => {
  it("returns null with no queue or no candidates ahead", () => {
    expect(pickNext(null, null, db(), [])).toBeNull();
    expect(pickNext(queueOf([item("only")], [], 0), null, db(), [])).toBeNull();
  });

  it("picks the most compatible analyzed track over queue order", () => {
    const store = db();
    store.set(features("current"));
    store.set(features("clash", { bpm: 95, camelot: "3A", energy: 0.1 }));
    store.set(features("match", { bpm: 126, camelot: "9B", energy: 0.55 }));
    const queue = queueOf([item("current"), item("clash"), item("match")], [], 0);
    const pick = pickNext(queue, makeVideoDetails({ id: "current" }), store, []);
    expect(pick).toMatchObject({ videoId: "match", queueIndex: 2 });
  });

  it("addresses automix candidates past the end of the queue items", () => {
    const store = db();
    store.set(features("current"));
    store.set(features("mix", { bpm: 128, camelot: "8B", energy: 0.5 }));
    const queue = queueOf([item("current"), item("unknown")], [item("mix")], 0);
    const pick = pickNext(queue, makeVideoDetails({ id: "current" }), store, []);
    expect(pick).toMatchObject({ videoId: "mix", queueIndex: 2 });
  });

  it("keeps queue order among unanalyzed candidates", () => {
    const queue = queueOf([item("current"), item("a"), item("b")], [], 0);
    const pick = pickNext(queue, makeVideoDetails({ id: "current" }), db(), []);
    expect(pick).toMatchObject({ videoId: "a", queueIndex: 1 });
  });

  it("avoids recently played tracks when scores are otherwise equal", () => {
    const store = db();
    store.set(features("current"));
    store.set(features("a"));
    store.set(features("b"));
    const queue = queueOf([item("current"), item("a"), item("b")], [], 0);
    const pick = pickNext(queue, makeVideoDetails({ id: "current" }), store, ["a"]);
    expect(pick).toMatchObject({ videoId: "b" });
  });

  it("filters library candidates down to unqueued, titled tracks", () => {
    const store = db();
    store.set(features("current"));
    store.set(features("queued"));
    store.set(features("nameless", { title: null }));
    store.set(features("eligible"));
    const queue = queueOf([item("current"), item("queued")], [], 0);
    const candidates = libraryCandidates(store, queue, makeVideoDetails({ id: "current" }));
    expect(candidates.map(track => track.videoId)).toEqual(["eligible"]);
  });

  it("prices recently played library tracks out until they age", () => {
    const store = db();
    store.set(features("current"));
    store.set(features("perfect"));
    const queue = queueOf([item("current"), item("unknown")], [], 0);
    const justPlayed = pickNext(queue, makeVideoDetails({ id: "current" }), store, ["perfect"]);
    expect(justPlayed).toMatchObject({ videoId: "unknown", source: "queue" });
    const aged = pickNext(queue, makeVideoDetails({ id: "current" }), store, [...Array(17).fill("x"), "perfect"]);
    expect(aged).toMatchObject({ videoId: "perfect", source: "library", queueIndex: null });
  });

  it("reaches into the library only for a clear win over the queue", () => {
    const store = db();
    store.set(features("current"));
    store.set(features("meh", { bpm: 100, camelot: "3A", energy: 0.1 }));
    store.set(features("perfect", { bpm: 128, camelot: "8B", energy: 0.5, author: "other" }));
    const queue = queueOf([item("current"), item("meh")], [], 0);
    const pick = pickNext(queue, makeVideoDetails({ id: "current" }), store, []);
    expect(pick).toMatchObject({ videoId: "perfect", source: "library", queueIndex: null });
  });

  it("stays in the queue when the current track is unanalyzed", () => {
    const store = db();
    store.set(features("tempting"));
    const queue = queueOf([item("current"), item("next")], [], 0);
    const pick = pickNext(queue, makeVideoDetails({ id: "current" }), store, []);
    expect(pick).toMatchObject({ videoId: "next", source: "queue" });
  });

  it("digs a queue renderer out of a nested next response", () => {
    const response = {
      contents: {
        deeply: [
          { nested: { playlistPanelVideoRenderer: { videoId: "other" } } },
          { nested: { playlistPanelVideoRenderer: { videoId: "wanted", navigationEndpoint: {} } } }
        ]
      }
    };
    const found = findQueueItemRenderer(response, "wanted");
    expect(found?.playlistPanelVideoRenderer.videoId).toBe("wanted");
    expect(findQueueItemRenderer(response, "absent")).toBeNull();
    expect(findQueueItemRenderer(null, "wanted")).toBeNull();
  });
});
