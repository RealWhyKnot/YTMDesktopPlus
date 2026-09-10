// Probes for the hooks this app grafts onto YouTube Music's internals.
//
// The YTM view preload polls these until the page is ready to be driven. They
// are also the health checks used to detect when YouTube Music changes its
// internals out from under us, so keep them in sync with the selectors and
// APIs used by the ytmview scripts.
//
// Probe sources are evaluated in the YTM page's main world via
// webFrame.executeJavaScript. They must never throw: they report what they
// observe, and repair what they can, so a failure can be logged with enough
// detail to act on.

import { KNOWN_PLAYER_API_RESOLVER, PLAYER_API_DUCK_TYPE, PLAYER_API_MEMBERS, PLAYER_API_RESOLVER_PATTERN } from "./ytm-contract";

export const HOOK_POLL_INTERVAL = 250;
export const HOOK_POLL_MAX_ATTEMPTS = 120; // 30 seconds per stage

// Canonical player bar selector; raw ytmview scripts must use it verbatim
// (enforced by tests/player-bar-selector.test.ts).
export const PLAYER_BAR_SELECTOR = "ytmusic-app-layout>ytmusic-player-bar";

export type PlayerApiSource = "property" | "scan" | "resolver" | "movie-player";

export type PlayerBarProbeSnapshot = {
  playerBarPresent: boolean;
  playerApiPresent: boolean;
  playerApiReady: boolean;
  resolverPresent: boolean;
  resolveError: string | null;
  resolvedVia: PlayerApiSource | null;
  candidateKeys: string[];
  missingMembers: string[];
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
    const DUCK_TYPE = ${JSON.stringify([...PLAYER_API_DUCK_TYPE])};
    const MEMBERS = ${JSON.stringify([...PLAYER_API_MEMBERS])};
    const RESOLVER = ${PLAYER_API_RESOLVER_PATTERN};
    const KNOWN_RESOLVER = ${JSON.stringify(KNOWN_PLAYER_API_RESOLVER)};
    const INTERESTING = /player|api/i;
    const MAX_CANDIDATE_KEYS = 20;

    function read(target, key) {
      try {
        return target[key];
      } catch {
        return undefined;
      }
    }

    function ducks(value) {
      if (!value || (typeof value !== "object" && typeof value !== "function")) return false;
      for (let i = 0; i < DUCK_TYPE.length; i++) {
        if (typeof read(value, DUCK_TYPE[i]) !== "function") return false;
      }
      return true;
    }

    function interestingKeys(target) {
      const found = [];
      let node = target;
      let depth = 0;
      while (node && depth < 6) {
        let names = [];
        try {
          names = Object.getOwnPropertyNames(node);
        } catch {
          names = [];
        }
        for (let i = 0; i < names.length; i++) {
          if (INTERESTING.test(names[i]) && found.indexOf(names[i]) === -1) found.push(names[i]);
        }
        node = Object.getPrototypeOf(node);
        depth++;
      }
      return found.slice(0, MAX_CANDIDATE_KEYS);
    }

    const playerBar = document.querySelector("${PLAYER_BAR_SELECTOR}");
    let playerApi = playerBar ? read(playerBar, "playerApi") : null;
    let resolvedVia = playerApi ? read(playerBar, "__ytmdPlayerApiVia") || "property" : null;
    let candidateKeys = [];
    let resolverKey = null;

    if (playerBar && !playerApi) {
      candidateKeys = interestingKeys(playerBar);
      for (let i = 0; i < candidateKeys.length; i++) {
        const key = candidateKeys[i];
        const value = read(playerBar, key);
        if (typeof value === "function" && value.length === 0 && RESOLVER.test(key)) {
          if (resolverKey === null || key === KNOWN_RESOLVER) resolverKey = key;
        }
        if (!playerApi && ducks(value)) {
          playerApi = value;
          resolvedVia = "scan";
        }
      }

      if (!playerApi) {
        const moviePlayer = document.querySelector("#movie_player");
        if (moviePlayer && moviePlayer !== playerBar && ducks(moviePlayer)) {
          playerApi = moviePlayer;
          resolvedVia = "movie-player";
        }
      }

      if (playerApi) {
        playerBar.playerApi = playerApi;
        playerBar.__ytmdPlayerApiVia = resolvedVia;
      } else if (resolverKey !== null && !playerBar.__ytmdPlayerApiResolvePending) {
        const trusted = resolverKey === KNOWN_RESOLVER;
        playerBar.__ytmdPlayerApiResolvePending = true;
        try {
          Promise.resolve(read(playerBar, resolverKey).call(playerBar)).then(
            function (api) {
              if (api && (trusted || ducks(api)) && !playerBar.playerApi) {
                playerBar.playerApi = api;
                playerBar.__ytmdPlayerApiVia = "resolver";
              }
            },
            function (error) {
              playerBar.__ytmdPlayerApiResolveError = String(error);
              playerBar.__ytmdPlayerApiResolvePending = false;
            }
          );
        } catch (error) {
          playerBar.__ytmdPlayerApiResolveError = String(error);
          playerBar.__ytmdPlayerApiResolvePending = false;
        }
      }
    }

    let ready = false;
    try {
      ready = !!(playerApi && playerApi.isReady());
    } catch {
      ready = false;
    }

    const missingMembers = [];
    if (playerApi) {
      for (let i = 0; i < MEMBERS.length; i++) {
        if (typeof read(playerApi, MEMBERS[i]) !== "function") missingMembers.push(MEMBERS[i]);
      }
    }

    return {
      playerBarPresent: !!playerBar,
      playerApiPresent: !!playerApi,
      playerApiReady: ready,
      resolverPresent: resolverKey !== null,
      resolveError: playerBar && playerBar.__ytmdPlayerApiResolveError ? String(playerBar.__ytmdPlayerApiResolveError) : null,
      resolvedVia: resolvedVia,
      candidateKeys: candidateKeys,
      missingMembers: missingMembers
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
