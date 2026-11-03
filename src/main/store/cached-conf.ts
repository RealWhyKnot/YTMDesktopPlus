import { setMaxListeners } from "node:events";
import fs from "node:fs";
import Conf, { type Options } from "conf";
import { writeFile } from "atomically";
import { getProperty } from "dot-prop";
import log from "electron-log";
import { stallTasks } from "../stall-watch";
import { isRecord } from "~shared/unknown";

const confMethods = { write: "_write", get: "_get", serialize: "_serialize", deserialize: "_deserialize" } as const;
const confWrite: unknown = Reflect.get(Conf.prototype, confMethods.write);

function invokeConf(method: unknown, target: object, ...args: unknown[]): unknown {
  if (typeof method !== "function") throw new TypeError("Config method is unavailable");
  return Reflect.apply(method, target, args);
}

export class CachedConf<T extends Record<string, unknown>> extends Conf<T> {
  private cached: T | undefined;
  private pending: string | undefined;
  private written: fs.Stats | undefined;
  private writing: Promise<void> | undefined;
  private isDeferWrites = false;

  static {
    this.prototype[confMethods.write] = function (this: CachedConf<Record<string, unknown>>, value: unknown) {
      stallTasks.timeSync("conf write", () => {
        const serialized = invokeConf(Reflect.get(this, confMethods.serialize), this, value);
        if (typeof serialized !== "string") throw new TypeError("Config serialization did not return text");
        this.pending = serialized;
        const deserialized = invokeConf(Reflect.get(this, confMethods.deserialize), this, this.pending);
        if (!isRecord(deserialized)) throw new TypeError("Config deserialization did not return an object");
        this.cached = deserialized;
      });
      if (!this.isDeferWrites) this.flushSync();
      else this.writing ??= this.drain();
    };
    this.prototype[confMethods.get] = function (this: CachedConf<Record<string, unknown>>, key: string, defaultValue: unknown) {
      return structuredClone(getProperty(this.current, key, defaultValue));
    };
  }

  constructor(options: Readonly<Partial<Options<T>>>) {
    super(options);
    setMaxListeners(64, this.events);
    this.events.addEventListener("change", () => {
      if (this.pending !== undefined) return;
      const written = this.written;
      if (written !== undefined) {
        const file = fs.statSync(this.path, { throwIfNoEntry: false });
        if (file?.ino === written.ino && file.size === written.size && file.mtimeMs === written.mtimeMs) return;
      }
      this.cached = undefined;
    });
    this.isDeferWrites = true;
  }

  override get store(): T {
    const value = structuredClone(this.current);
    Object.setPrototypeOf(value, null);
    return value;
  }

  override set store(value: T) {
    super.store = value;
  }

  flush(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  flushSync() {
    this.isDeferWrites = false;
    if (this.pending === undefined) return;
    stallTasks.timeSync("conf flush", () => invokeConf(confWrite, this, this.cached));
    if (!this.writing) this.pending = undefined;
  }

  private get current(): T {
    return (this.cached ??= super.store);
  }

  private async drain() {
    try {
      while (this.pending !== undefined && this.isDeferWrites) {
        const data = this.pending;
        await writeFile(this.path, data);
        this.written = await fs.promises.stat(this.path);
        if (this.pending === data) this.pending = undefined;
      }
    } catch (error) {
      log.error("Failed to write config file", error);
    }
    this.writing = undefined;
    if (!this.isDeferWrites) this.flushSync();
  }
}
