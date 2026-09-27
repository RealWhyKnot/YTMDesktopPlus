import Conf, { type Options } from "conf";

export class CachedConf<T extends Record<string, unknown>> extends Conf<T> {
  private cached: T | undefined;

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
    this.cached = undefined;
    super.store = value;
  }
}
