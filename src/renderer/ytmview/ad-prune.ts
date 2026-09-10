import type { AdPruneContract } from "~shared/ad-contract";

// Ad metadata rides inline in the POST /youtubei/v1/player JSON and the ad media
// streams from the same googlevideo hosts as the music, so no network filter can
// separate the two. YouTube Music parses that payload with JSON.parse over XHR
// and defines no ytInitialPlayerResponse, so this is the only point the ad can be
// taken out.
//
// Serialized by contextBridge.executeInMainWorld: it may reference nothing
// outside its own arguments and page globals.
export function installAdPrune(enabled: boolean, contract: AdPruneContract): void {
  type PruneState = { enabled: boolean; count: number; reported: boolean; unknown: string[] };
  const pruneWindow = window as typeof window & {
    __ytmdAdPrune?: PruneState;
    ytmd?: {
      sendAdBlockEvent?: (kind: string, detail?: unknown) => void;
      reportContractMiss?: (what: string, detail?: unknown) => void;
    };
  };

  if (pruneWindow.__ytmdAdPrune) {
    pruneWindow.__ytmdAdPrune.enabled = enabled;
    return;
  }

  const state: PruneState = { enabled, count: 0, reported: false, unknown: [] };
  pruneWindow.__ytmdAdPrune = state;

  const adKeys = contract.keys;
  const markers = contract.markers;
  const unknownAdKey = new RegExp(contract.unknownKeyPattern);
  const nativeParse = JSON.parse;

  const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  };

  const pruneObject = (record: Record<string, unknown> | null, removed: string[]): void => {
    if (!record) return;

    for (const key of adKeys) {
      if (!(key in record)) continue;
      delete record[key];
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
    const result = nativeParse(text, reviver);
    if (!state.enabled) return result;

    // A throw here would break every JSON.parse on the page.
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
    } catch {
      // Nothing to do; the payload goes back as it came.
    }

    return result;
  };
}
