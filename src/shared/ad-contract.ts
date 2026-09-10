export const AD_RESPONSE_KEYS = ["adPlacements", "adSlots", "playerAds"] as const;

export const AD_SKIP_SELECTORS = [".ytp-ad-skip-button-modern", ".ytp-ad-skip-button", ".ytp-skip-ad-button"] as const;

export const AD_PLAYING_PATH = "player.adPlaying";

export const PLAYER_RESPONSE_MARKERS = ["streamingData", "videoDetails"] as const;

export const UNKNOWN_AD_KEY_PATTERN = /^(ad[A-Z]|playerAd)/;

export type AdPruneContract = {
  keys: readonly string[];
  markers: readonly string[];
  unknownKeyPattern: string;
};

export const AD_PRUNE_CONTRACT: AdPruneContract = {
  keys: AD_RESPONSE_KEYS,
  markers: PLAYER_RESPONSE_MARKERS,
  unknownKeyPattern: UNKNOWN_AD_KEY_PATTERN.source
};
