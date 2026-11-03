export function installExperimentFlagPins(pins: Readonly<Record<string, boolean>>): void {
  type YtConfig = { get?: (key: string, fallback?: unknown) => unknown; set?: (...args: unknown[]) => unknown };
  type PinWindow = {
    ytcfg?: YtConfig;
    __ytmdFlagPins?: true;
    ytmd?: { reportContractMiss?: (what: string, detail?: unknown) => void };
  };
  const pinWindow: PinWindow = window as typeof window & PinWindow;

  if (pinWindow.__ytmdFlagPins) return;
  pinWindow.__ytmdFlagPins = true;

  const reported: string[] = [];
  const wrapped = new WeakSet<object>();
  const flagText = (value: unknown) => String(value);

  const applyPins = (config: YtConfig) => {
    let flags: unknown;
    try {
      flags = config.get?.("EXPERIMENT_FLAGS");
    } catch {
      return;
    }
    if (!flags || typeof flags !== "object") return;
    for (const name of Object.keys(pins)) {
      const served: unknown = Reflect.get(flags, name);
      if (!Reflect.set(flags, name, pins[name])) throw new TypeError(`Cannot set experiment flag ${name}`);
      if (served === undefined || flagText(served) === String(pins[name]) || reported.includes(name)) continue;
      reported.push(name);
      pinWindow.ytmd?.reportContractMiss?.(`experiment flag ${name} pinned to ${pins[name]}`, flagText(served));
    }
  };

  const wrap = (config: unknown) => {
    if (!config || typeof config !== "object" || wrapped.has(config)) return;
    const target = config as YtConfig;
    const nativeSet = target.set;
    if (typeof nativeSet !== "function") return;
    wrapped.add(config);
    target.set = function (this: unknown, ...args: unknown[]) {
      const result = nativeSet.apply(this, args);
      applyPins(target);
      return result;
    };
    applyPins(target);
  };

  let current: unknown = pinWindow.ytcfg;
  wrap(current);
  Object.defineProperty(pinWindow, "ytcfg", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: (value: unknown) => {
      current = value;
      wrap(value);
    },
  });
}
