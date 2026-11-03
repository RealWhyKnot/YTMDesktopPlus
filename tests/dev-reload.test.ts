import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchExternalAddonsForDev } from "../src/main/addons/dev-reload";
import { makeTempDir } from "./helpers/temp-dir";
import { mockFileWatchers } from "./helpers/file-watcher";

const log = { info: vi.fn(), warn: vi.fn() };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("dev reload watcher", () => {
  it("watches an addon whose manifest was broken at boot", async () => {
    vi.useFakeTimers();
    const watchers = mockFileWatchers();
    const root = makeTempDir("ytmd-devreload-");
    const dir = path.join(root, "broken");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "manifest.json"), "{ not json");
    const reload = vi.fn(() => Promise.resolve(undefined));
    const stop = watchExternalAddonsForDev([{ dir, folderName: "broken", error: "manifest.json could not be parsed" }], reload, log);

    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: "broken", name: "b", version: "1.0.0", author: "a", description: "d" }));
    watchers.change(dir, "manifest.json");
    await vi.runAllTimersAsync();
    expect(reload).toHaveBeenCalledWith("broken");
    stop();
  });

  it("keeps watching the other folders when one cannot be watched", () => {
    const root = makeTempDir("ytmd-devreload-");
    const good = path.join(root, "good");
    fs.mkdirSync(good);
    const reload = vi.fn(() => Promise.resolve(undefined));
    const stop = watchExternalAddonsForDev(
      [
        { dir: path.join(root, "gone"), folderName: "gone", error: "missing" },
        { dir: good, folderName: "good", manifest: { id: "good", name: "g", version: "1.0.0", author: "a", description: "d" } },
      ],
      reload,
      log
    );

    expect(log.warn).toHaveBeenCalled();
    stop();
  });
});
