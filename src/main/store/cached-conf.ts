import fs from "node:fs";
import Conf, { type Options } from "conf";
import { writeFile } from "atomically";
import { getProperty } from "dot-prop";
import log from "electron-log";
import { stallTasks } from "../stall-watch";

const confWrite = Conf.prototype["_write"];

export class CachedConf<T extends Record<string, unknown>> extends Conf<T> {
  private cached: T | undefined;
  private pending: string | undefined;
  private written: fs.Stats | undefined;
  private writing: Promise<void> | undefined;
  private deferWrites = false;

  static {
    this.prototype["_write"] = function (this: CachedConf<Record<string, unknown>>, value: unknown) {
      stallTasks.timeSync("conf write", () => {
        this.pending = this["_serialize"](value);
        this.cached = this["_deserialize"](this.pending);
      });
      if (!this.deferWrites) this.flushSync();
      else this.writing ??= this.drain();
    };
    this.prototype["_get"] = function (this: CachedConf<Record<string, unknown>>, key: string, defaultValue: unknown) {
      return structuredClone(getProperty(this.current, key, defaultValue));
    };
  }

  constructor(options: Readonly<Partial<Options<T>>>) {
    super(options);
    this.events.addEventListener("change", () => {
      if (this.pending !== undefined) return;
      const file = this.written && fs.statSync(this.path, { throwIfNoEntry: false });
      if (file && file.ino === this.written.ino && file.size === this.written.size && file.mtimeMs === this.written.mtimeMs) return;
      this.cached = undefined;
    });
    this.deferWrites = true;
  }

  get store(): T {
    return Object.assign(Object.create(null), structuredClone(this.current));
  }

  set store(value: T) {
    super.store = value;
  }

  flush(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  flushSync() {
    this.deferWrites = false;
    if (this.pending === undefined) return;
    stallTasks.timeSync("conf flush", () => confWrite.call(this, this.cached));
    if (!this.writing) this.pending = undefined;
  }

  private get current(): T {
    return (this.cached ??= super.store);
  }

  private async drain() {
    try {
      while (this.pending !== undefined && this.deferWrites) {
        const data = this.pending;
        await writeFile(this.path, data);
        this.written = await fs.promises.stat(this.path);
        if (this.pending === data) this.pending = undefined;
      }
    } catch (error) {
      log.error("Failed to write config file", error);
    }
    this.writing = undefined;
    if (!this.deferWrites) this.flushSync();
  }
}
