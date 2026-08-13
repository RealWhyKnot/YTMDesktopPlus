import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYSIS_VERSION, FeatureDb } from "../src/addons/bundled/dj/feature-db";
import type { TrackFeatures } from "../src/addons/bundled/dj/scoring";
import { makeTempDir } from "./helpers/temp-dir";

function features(videoId: string): TrackFeatures {
  return {
    videoId,
    bpm: 128,
    bpmConfidence: 0.9,
    camelot: "8B",
    keyConfidence: 0.8,
    energy: 0.5,
    loudnessDb: -1.2,
    durationS: 201.5,
    beatOffsetS: 0.31,
    analysisVersion: ANALYSIS_VERSION,
    analyzedAt: 1755000000000
  };
}

describe("dj feature db", () => {
  it("round-trips records through disk", async () => {
    const file = path.join(makeTempDir("dj-db-"), "features.json");
    const db = new FeatureDb(file, 1);
    await db.load();
    db.set(features("a"));
    db.set(features("b"));
    await db.flush();

    const reloaded = new FeatureDb(file);
    await reloaded.load();
    expect(reloaded.size()).toBe(2);
    expect(reloaded.get("a")).toEqual(features("a"));
    expect(reloaded.has("missing")).toBe(false);
  });

  it("leaves no tmp file behind after a flush", async () => {
    const dir = makeTempDir("dj-db-");
    const file = path.join(dir, "features.json");
    const db = new FeatureDb(file);
    await db.load();
    db.set(features("a"));
    await db.flush();
    const names = await fs.readdir(dir);
    expect(names).toEqual(["features.json"]);
  });

  it("starts empty on a corrupt file instead of throwing", async () => {
    const file = path.join(makeTempDir("dj-db-"), "features.json");
    await fs.writeFile(file, "{not json", "utf8");
    const db = new FeatureDb(file);
    await db.load();
    expect(db.size()).toBe(0);
  });

  it("drops every record when the analysis version moved on", async () => {
    const file = path.join(makeTempDir("dj-db-"), "features.json");
    await fs.writeFile(file, JSON.stringify({ analysisVersion: ANALYSIS_VERSION - 1, tracks: { a: features("a") } }), "utf8");
    const db = new FeatureDb(file);
    await db.load();
    expect(db.size()).toBe(0);
  });

  it("debounces scheduled flushes into one write", async () => {
    const file = path.join(makeTempDir("dj-db-"), "features.json");
    const db = new FeatureDb(file, 10);
    await db.load();
    db.set(features("a"));
    db.set(features("b"));
    await new Promise(resolve => setTimeout(resolve, 60));
    const reloaded = new FeatureDb(file);
    await reloaded.load();
    expect(reloaded.size()).toBe(2);
  });
});
