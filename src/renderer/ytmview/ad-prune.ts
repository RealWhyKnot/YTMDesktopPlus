import type { AdPruneContract } from "~shared/ad-contract";

export function installAdPrune(isEnabled: boolean, contract: AdPruneContract): void {
  type PruneState = { enabled: boolean; count: number; reported: boolean; unknown: string[] };
  type PruneWindow = {
    __ytmdAdPrune?: PruneState;
    ytmd?: {
      sendAdBlockEvent?: (kind: string, detail?: unknown) => void;
      reportContractMiss?: (what: string, detail?: unknown) => void;
    };
  };
  const pruneWindow: PruneWindow = window as typeof window & PruneWindow;

  if (pruneWindow.__ytmdAdPrune) {
    pruneWindow.__ytmdAdPrune.enabled = isEnabled;
    return;
  }

  const state: PruneState = { enabled: isEnabled, count: 0, reported: false, unknown: [] };
  pruneWindow.__ytmdAdPrune = state;

  const adKeys = contract.keys;
  const markers = contract.markers;
  const unknownAdKey = new RegExp(contract.unknownKeyPattern);
  const nativeParse = JSON.parse;

  const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
  const asRecord = (value: unknown): Record<string, unknown> | null => (isRecord(value) ? value : null);

  const pruneObject = (record: Record<string, unknown> | null, removed: string[]): void => {
    if (!record) return;

    for (const key of adKeys) {
      if (!(key in record)) continue;
      if (!Reflect.deleteProperty(record, key)) throw new TypeError(`Cannot delete property '${key}'`);
      removed.push(key);
    }
  };

  const auditObject = (record: Record<string, unknown> | null): void => {
    if (!record) return;
    for (const marker of markers) if (!(marker in record)) return;

    for (const key of Object.keys(record)) {
      if (!unknownAdKey.test(key) || adKeys.includes(key) || state.unknown.includes(key)) continue;
      state.unknown.push(key);
      pruneWindow.ytmd?.reportContractMiss?.(`player response ad key ${key}`);
    }
  };

  JSON.parse = function (text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown {
    const result: unknown = nativeParse(text, reviver);
    if (!state.enabled) return result;

    try {
      const root = asRecord(result);
      const nested = asRecord(root?.playerResponse);
      const removed: string[] = [];

      pruneObject(root, removed);
      pruneObject(nested, removed);

      if (removed.length > 0) {
        state.count++;
        if (!state.reported) {
          state.reported = true;
          pruneWindow.ytmd?.sendAdBlockEvent?.("pruned", removed);
        }
      }

      auditObject(root);
      auditObject(nested);
    } catch (error) {
      console.warn("ad-prune: operation failed", error);
    }

    return result;
  };
}
