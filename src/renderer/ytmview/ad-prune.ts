// Ad metadata rides inline in the POST /youtubei/v1/player JSON and the ad media
// streams from the same googlevideo hosts as the music, so no network filter can
// separate the two. YouTube Music parses that payload with JSON.parse over XHR
// and defines no ytInitialPlayerResponse, so this is the only point the ad can be
// taken out.
//
// Serialized by contextBridge.executeInMainWorld: it may reference nothing
// outside its own arguments and page globals.
export function installAdPrune(enabled: boolean): void {
  type PruneState = { enabled: boolean; count: number; reported: boolean };
  const pruneWindow = window as typeof window & {
    __ytmdAdPrune?: PruneState;
    ytmd?: { sendAdBlockEvent?: (kind: string, detail?: unknown) => void };
  };

  if (pruneWindow.__ytmdAdPrune) {
    pruneWindow.__ytmdAdPrune.enabled = enabled;
    return;
  }

  const state: PruneState = { enabled, count: 0, reported: false };
  pruneWindow.__ytmdAdPrune = state;

  const adKeys = ["adSlots", "playerAds", "adPlacements"];
  const nativeParse = JSON.parse;

  const pruneObject = (value: unknown, removed: string[]): void => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return;

    const record = value as Record<string, unknown>;
    for (const key of adKeys) {
      if (!(key in record)) continue;
      delete record[key];
      removed.push(key);
    }
  };

  JSON.parse = function (text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown): unknown {
    const result = nativeParse(text, reviver);
    if (!state.enabled) return result;

    // A throw here would break every JSON.parse on the page.
    try {
      const removed: string[] = [];
      pruneObject(result, removed);
      pruneObject((result as { playerResponse?: unknown } | null)?.playerResponse, removed);
      if (removed.length === 0) return result;

      state.count++;
      if (!state.reported) {
        state.reported = true;
        pruneWindow.ytmd?.sendAdBlockEvent?.("pruned", removed);
      }
    } catch {
      // Nothing to do; the payload goes back as it came.
    }

    return result;
  };
}
