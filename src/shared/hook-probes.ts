// Probes for the hooks this app grafts onto YouTube Music's internals.
//
// The YTM view preload polls these until the page is ready to be driven. They
// are also the health checks used to detect when YouTube Music changes its
// internals out from under us, so keep them in sync with the selectors and
// APIs used by the ytmview scripts.
//
// Probe sources are evaluated in the YTM page's main world via
// webFrame.executeJavaScript. They must never throw: they report what they
// observe so a failure can be logged with enough detail to act on.

export const HOOK_POLL_INTERVAL = 250;
export const HOOK_POLL_MAX_ATTEMPTS = 120; // 30 seconds per stage

// Canonical player bar selector; raw ytmview scripts must use it verbatim
// (enforced by tests/player-bar-selector.test.ts).
export const PLAYER_BAR_SELECTOR = "ytmusic-app-layout>ytmusic-player-bar";

export type PlayerBarProbeSnapshot = {
  playerBarPresent: boolean;
  playerApiPresent: boolean;
  playerApiReady: boolean;
};

// Stage 1: the store hook installed by the Polymer base class trap.
export const storeHookProbeSource = `
  (function() {
    return !!window.__YTMD_HOOK__;
  })
`;

// Stage 2: the player bar element and its player API.
export const playerBarProbeSource = `
  (function() {
    const playerBar = document.querySelector("${PLAYER_BAR_SELECTOR}");
    const playerApi = playerBar ? playerBar.playerApi : null;
    let ready = false;
    try {
      ready = !!(playerApi && playerApi.isReady());
    } catch {
      ready = false;
    }
    return {
      playerBarPresent: !!playerBar,
      playerApiPresent: !!playerApi,
      playerApiReady: ready
    };
  })
`;

export type PollResult<T> = {
  done: boolean;
  attempts: number;
  last: T | null;
  lastError: string | null;
};

// A probe that throws counts as a failed attempt instead of killing the poll:
// an exception escaping an unbounded poll loop is exactly how the app used to
// hang on the loading screen forever.
export async function pollUntil<T>(probe: () => Promise<T>, isDone: (result: T) => boolean, intervalMs: number, maxAttempts: number): Promise<PollResult<T>> {
  let last: T | null = null;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      last = await probe();
      lastError = null;
      if (isDone(last)) {
        return { done: true, attempts: attempt, last, lastError: null };
      }
    } catch (error) {
      lastError = String(error);
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  return { done: false, attempts: maxAttempts, last, lastError };
}
