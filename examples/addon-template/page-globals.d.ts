export type PageWindow = {
  __YTMD_HOOK__?: {
    ytmStore: {
      getState(): unknown;
      dispatch(action: { type: string; payload?: unknown }): void;
      subscribe(listener: () => void): () => void;
    };
  };

  ytmd?: {
    postAddonMessage(addonId: string, name: string, payload?: unknown): void;
  };
};
