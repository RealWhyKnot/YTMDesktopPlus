// Globals available inside the YouTube Music page, for page scripts.
declare interface Window {
  /** The page's own store, frozen and read-safe: getState, dispatch, subscribe. */
  __YTMD_HOOK__?: {
    ytmStore: {
      getState(): unknown;
      dispatch(action: { type: string; payload?: unknown }): void;
      subscribe(listener: () => void): () => void;
    };
  };
}
