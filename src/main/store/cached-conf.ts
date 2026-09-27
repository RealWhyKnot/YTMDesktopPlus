import Conf, { type Options } from "conf";

export class CachedConf<T extends Record<string, unknown>> extends Conf<T> {
  private cached: T | undefined;

  static {
    const write = Conf.prototype["_write"];
    this.prototype["_write"] = function (this: CachedConf<Record<string, unknown>>, value: unknown) {
      this.cached = undefined;
      write.call(this, value);
    };
  }

  constructor(options: Readonly<Partial<Options<T>>>) {
    super(options);
    this.events.addEventListener("change", () => {
      this.cached = undefined;
    });
  }

  get store(): T {
    this.cached ??= super.store;
    return Object.assign(Object.create(null), structuredClone(this.cached));
  }

  set store(value: T) {
    super.store = value;
  }
}
