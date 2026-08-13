import path from "node:path";
import { describe, expect, it } from "vitest";
import { pickNext } from "../src/addons/bundled/dj/auto-dj";
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
});
