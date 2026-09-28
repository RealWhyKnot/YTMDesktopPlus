import fs from "node:fs";
import path from "node:path";
import { writeFile } from "atomically";
import Conf from "conf";
import log from "electron-log";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CachedConf } from "../src/main/store/cached-conf";
import { makeTempDir } from "./helpers/temp-dir";

vi.mock("atomically", async importOriginal => {
  const actual = await importOriginal<typeof import("atomically")>();
  return { ...actual, writeFile: vi.fn(actual.writeFile) };
});

type Schema = { playback: { volume: number; tags: string[] }; state: { lastUrl: string } };

const DEFAULTS: Schema = { playback: { volume: 50, tags: [] }, state: { lastUrl: "https://music.youtube.com/" } };

const MIGRATING = {
  configName: "config",
  defaults: DEFAULTS,
  projectVersion: "2.0.0",
  migrations: {
    ">=2.0.0": (migrating: Conf<Schema>) => {
      if (!migrating.has("playback.volume")) migrating.set("playback.volume", 50);
    }
  }
};

function readConfigFile(cwd: string) {
  return JSON.parse(fs.readFileSync(path.join(cwd, "config.json"), "utf8"));
}

function readVolume(file: string) {
  return JSON.parse(fs.readFileSync(file, "utf8")).playback.volume;
}

const stores: CachedConf<Schema>[] = [];

function makeStore() {
  const cwd = makeTempDir("ytmd-conf-");
  const store = new CachedConf<Schema>({ cwd, configName: "config", defaults: DEFAULTS, projectVersion: "1.0.0" });
  stores.push(store);
  return { store, file: path.join(cwd, "config.json") };
}

function settled(store: CachedConf<Schema>) {
  return vi.waitFor(() => expect(store["writing"]).toBe(false));
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map(settled));
  vi.restoreAllMocks();
});

describe("CachedConf", () => {
  it("serves repeated reads from memory instead of the config file", () => {
    const { store, file } = makeStore();
    store.get("playback");
    const reads = vi.spyOn(fs, "readFileSync");

    for (let i = 0; i < 50; i++) store.get("playback");

    expect(reads.mock.calls.filter(call => String(call[0]) === file)).toHaveLength(0);
  });

  it("hands out copies, so a caller mutating a result does not change the store", () => {
    const { store } = makeStore();

    const playback = store.get("playback");
    playback.volume = 5;
    playback.tags.push("mutated");

    expect(store.get("playback")).toEqual({ volume: 50, tags: [] });
  });

  it("copies only the requested value on a keyed read", () => {
    const { store } = makeStore();
    store.get("state");
    const clone = vi.spyOn(globalThis, "structuredClone");

    const tags = store.get("playback.tags");
    tags.push("mutated");

    expect(clone.mock.calls.map(([value]) => value)).toEqual([[]]);
    expect(store.get("playback").tags).toEqual([]);
  });

  it("returns what was just written and tells change listeners the old and new values", () => {
    const { store } = makeStore();
    const seen: [unknown, unknown][] = [];
    store.onDidChange("playback", (next, previous) => seen.push([next, previous]));

    store.set("playback.volume", 80);

    expect(store.get("playback").volume).toBe(80);
    expect(seen).toEqual([
      [
        { volume: 80, tags: [] },
        { volume: 50, tags: [] }
      ]
    ]);
  });

  it("sees its own writes while a migration is still running inside the constructor", () => {
    const cwd = makeTempDir("ytmd-conf-");
    const readBack: unknown[] = [];
    new CachedConf<Schema>({
      cwd,
      configName: "config",
      defaults: DEFAULTS,
      projectVersion: "2.0.0",
      migrations: {
        ">=2.0.0": migrating => {
          migrating.set("state.lastUrl", "https://music.youtube.com/explore");
          readBack.push(migrating.get("state.lastUrl"));
        }
      }
    });

    expect(readBack).toEqual(["https://music.youtube.com/explore"]);
  });

  it.each([
    ["no config file", undefined],
    ["a config file missing a section", { playback: { volume: 20, tags: ["kept"] } }]
  ])("ends a migration from %s with what plain conf writes, then reads from memory", (_, existing) => {
    const cachedDir = makeTempDir("ytmd-conf-");
    const plainDir = makeTempDir("ytmd-conf-");
    for (const dir of existing ? [cachedDir, plainDir] : []) {
      fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(existing));
    }

    const store = new CachedConf<Schema>({ cwd: cachedDir, ...MIGRATING });
    const plain = new Conf<Schema>({ cwd: plainDir, ...MIGRATING });

    expect(store.get("state")).toEqual(DEFAULTS.state);
    expect(store.store).toEqual(plain.store);
    expect(readConfigFile(cachedDir)).toEqual(readConfigFile(plainDir));
    const reads = vi.spyOn(fs, "readFileSync");
    for (let i = 0; i < 50; i++) store.get("playback");
    expect(reads.mock.calls.filter(call => String(call[0]) === path.join(cachedDir, "config.json"))).toHaveLength(0);
  });

  it("rereads the file once after a change event from outside the process", () => {
    const { store, file } = makeStore();
    store.get("state");
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    written.state.lastUrl = "https://music.youtube.com/library";
    fs.writeFileSync(file, JSON.stringify(written));

    expect(store.get("state").lastUrl).toBe("https://music.youtube.com/");
    const reads = vi.spyOn(fs, "readFileSync");
    store.events.dispatchEvent(new Event("change"));

    expect(store.get("state").lastUrl).toBe("https://music.youtube.com/library");
    expect(store.get("state").lastUrl).toBe("https://music.youtube.com/library");
    expect(reads.mock.calls.filter(call => String(call[0]) === file)).toHaveLength(1);
  });

  it("returns a write before it reaches the disk, then writes it in the background", async () => {
    const { store, file } = makeStore();

    store.set("playback.volume", 80);

    expect(store.get("playback").volume).toBe(80);
    expect(readVolume(file)).toBe(50);
    await settled(store);
    expect(readVolume(file)).toBe(80);
  });

  it("writes a burst as the write in flight plus the latest, in order", async () => {
    const { store, file } = makeStore();
    vi.mocked(writeFile).mockClear();

    store.set("playback.volume", 60);
    store.set("playback.volume", 70);
    store.set("playback.volume", 80);
    await settled(store);

    expect(vi.mocked(writeFile).mock.calls.map(([, data]) => JSON.parse(String(data)).playback.volume)).toEqual([60, 80]);
    expect(readVolume(file)).toBe(80);
  });

  it("flushSync writes pending changes before returning and every change after it", async () => {
    const { store, file } = makeStore();
    store.set("playback.volume", 60);
    store.set("playback.volume", 80);

    store.flushSync();

    expect(readVolume(file)).toBe(80);
    await settled(store);
    expect(readVolume(file)).toBe(80);
    store.set("playback.volume", 90);
    expect(readVolume(file)).toBe(90);
  });

  it("keeps a write that failed pending for the next flush", async () => {
    const { store, file } = makeStore();
    vi.mocked(writeFile).mockRejectedValueOnce(new Error("EPERM"));
    const errors = vi.spyOn(log, "error").mockImplementation(() => undefined);

    store.set("playback.volume", 80);
    await settled(store);

    expect(errors).toHaveBeenCalledOnce();
    expect(readVolume(file)).toBe(50);
    store.flushSync();
    expect(readVolume(file)).toBe(80);
  });

  it("keeps serving a pending write when the file watcher reports a change", () => {
    const { store, file } = makeStore();
    store.set("playback.volume", 80);
    const reads = vi.spyOn(fs, "readFileSync");

    store.events.dispatchEvent(new Event("change"));

    expect(store.get("playback").volume).toBe(80);
    expect(reads.mock.calls.filter(call => String(call[0]) === file)).toHaveLength(0);
  });

  it("does not reread the file for the watcher event of its own finished write", async () => {
    const { store, file } = makeStore();
    store.set("playback.volume", 80);
    await settled(store);
    const reads = vi.spyOn(fs, "readFileSync");

    store.events.dispatchEvent(new Event("change"));

    expect(store.get("playback").volume).toBe(80);
    expect(reads.mock.calls.filter(call => String(call[0]) === file)).toHaveLength(0);
  });

  it("reloads a change from outside the process that follows its own write", async () => {
    const { store, file } = makeStore();
    store.set("playback.volume", 80);
    await settled(store);
    const written = JSON.parse(fs.readFileSync(file, "utf8"));
    written.playback.volume = 5;
    fs.writeFileSync(file, JSON.stringify(written));

    store.events.dispatchEvent(new Event("change"));

    expect(store.get("playback").volume).toBe(5);
  });
});
