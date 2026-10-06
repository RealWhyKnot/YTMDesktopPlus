export function installExperimentFlagPins(pins: Readonly<Record<string, boolean>>): void {
  type YtConfig = { get?: (key: string, fallback?: unknown) => unknown; set?: (...args: unknown[]) => unknown };
  const pinWindow = window as typeof window & {
    ytcfg?: YtConfig;
    __ytmdFlagPins?: true;
    ytmd?: { reportContractMiss?: (what: string, detail?: unknown) => void };
  };

  if (pinWindow.__ytmdFlagPins) return;
  pinWindow.__ytmdFlagPins = true;

  const reported: string[] = [];
  const wrapped = new WeakSet<object>();

  const applyPins = (config: YtConfig) => {
    let flags: unknown;
    try {
      flags = config.get?.("EXPERIMENT_FLAGS");
    } catch {
      return;
    }
    if (!flags || typeof flags !== "object") return;
    const record = flags as Record<string, unknown>;
    for (const name of Object.keys(pins)) {
      const served = record[name];
      record[name] = pins[name];
      if (served === undefined || String(served) === String(pins[name]) || reported.includes(name)) continue;
      reported.push(name);
      pinWindow.ytmd?.reportContractMiss?.(`experiment flag ${name} pinned to ${pins[name]}`, String(served));
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

  let current = pinWindow.ytcfg;
  wrap(current);
  Object.defineProperty(pinWindow, "ytcfg", {
    configurable: true,
    enumerable: true,
    get: () => current,
    set: value => {
      current = value;
      wrap(value);
    }
  });
}
