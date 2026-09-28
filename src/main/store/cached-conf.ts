import Conf, { type Options } from "conf";
import { getProperty } from "dot-prop";
import { stallTasks } from "../stall-watch";

export class CachedConf<T extends Record<string, unknown>> extends Conf<T> {
  private cached: T | undefined;

  static {
    const write = Conf.prototype["_write"];
    this.prototype["_write"] = function (this: CachedConf<Record<string, unknown>>, value: unknown) {
      this.cached = undefined;
      stallTasks.timeSync("conf write", () => write.call(this, value));
    };
    this.prototype["_get"] = function (this: CachedConf<Record<string, unknown>>, key: string, defaultValue: unknown) {
      return structuredClone(getProperty(this.current, key, defaultValue));
    };
  }

  constructor(options: Readonly<Partial<Options<T>>>) {
    super(options);
    this.events.addEventListener("change", () => {
      this.cached = undefined;
    });
  }

  get store(): T {
    return Object.assign(Object.create(null), structuredClone(this.current));
  }

  set store(value: T) {
    super.store = value;
  }

  private get current(): T {
    return (this.cached ??= super.store);
  }
}
