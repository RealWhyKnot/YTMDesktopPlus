import type { PageWindow } from "./page-globals.d.ts";

export function runScript() {
  const pageWindow: Window & PageWindow = window;
  const hook = pageWindow.__YTMD_HOOK__;

  const state = hook?.ytmStore.getState();
  const queue = state && typeof state === "object" && "queue" in state ? state.queue : undefined;
  const items = queue && typeof queue === "object" && "items" in queue ? queue.items : undefined;
  return {
    path: location.pathname,
    queued: !!(items && (typeof items === "string" || (typeof items === "object" && "length" in items)) && items.length),
  };
}
