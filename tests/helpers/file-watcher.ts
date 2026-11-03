import { EventEmitter } from "node:events";
import fs from "node:fs";
import { vi } from "vitest";

class FileWatcher extends EventEmitter implements fs.FSWatcher {
  close() {
    this.removeAllListeners();
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }
}

export function mockFileWatchers() {
  const watchers = new Map<fs.PathLike, FileWatcher>();
  vi.spyOn(fs, "watch").mockImplementation((...args) => {
    const watcher = new FileWatcher();
    const listener = args.find((value) => typeof value === "function");
    if (typeof listener === "function") {
      watcher.on("change", (...values: unknown[]) => {
        Reflect.apply(listener, undefined, values);
      });
    }
    watchers.set(args[0], watcher);
    return watcher;
  });
  return {
    change(directory: string, filename: string) {
      const watcher = watchers.get(directory);
      if (!watcher) throw new Error(`No watcher for ${directory}`);
      watcher.emit("change", "change", filename);
    },
  };
}
