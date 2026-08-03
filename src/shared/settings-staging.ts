// Staging model for the settings window: edits accumulate in a draft and are
// written to the store only on an explicit save. Keys not listed here keep
// their immediate write path (auth tokens, session keys, memory store fields).
export const STAGED_SETTING_KEYS = [
  "general.hideToTrayOnClose",
  "general.showNotificationOnSongChange",
  "general.startOnBoot",
  "general.startMinimized",
  "general.disableHardwareAcceleration",
  "developer.debugLogging",
  "appearance.alwaysShowVolumeSlider",
  "appearance.customCSSEnabled",
  "appearance.customCSSPath",
  "appearance.zoom",
  "appearance.trayIconStyle",
  "playback.continueWhereYouLeftOff",
  "playback.continueWhereYouLeftOffPaused",
  "playback.progressInTaskbar",
  "playback.enableSpeakerFill",
  "playback.ratioVolume",
  "playback.loudnessNormalization",
  "integrations.companionServerEnabled",
  "integrations.companionServerCORSWildcardEnabled",
  "integrations.discordPresenceEnabled",
  "integrations.lastFMEnabled",
  "integrations.listenAlongRoomsEnabled",
  "integrations.listenAlongDisplayName",
  "lastfm.scrobblePercent",
  "shortcuts.playPause",
  "shortcuts.next",
  "shortcuts.previous",
  "shortcuts.thumbsUp",
  "shortcuts.thumbsDown",
  "shortcuts.volumeUp",
  "shortcuts.volumeDown",
  "updates.autoUpdateEnabled",
  "updates.channel"
] as const;

export type StagedSettingKey = (typeof STAGED_SETTING_KEYS)[number];
export type SettingsSnapshot = Record<StagedSettingKey, unknown>;

export const RESTART_REQUIRED_KEYS: ReadonlySet<StagedSettingKey> = new Set<StagedSettingKey>([
  "general.disableHardwareAcceleration",
  "playback.enableSpeakerFill"
]);

// Range inputs bound through v-model deliver strings; the store expects numbers.
const NUMERIC_KEYS: ReadonlySet<StagedSettingKey> = new Set<StagedSettingKey>([
  "appearance.zoom",
  "appearance.trayIconStyle",
  "lastfm.scrobblePercent",
  "updates.channel"
]);

export function normalizeSettingValue(key: StagedSettingKey, value: unknown): unknown {
  if (NUMERIC_KEYS.has(key) && value !== null && value !== undefined && typeof value !== "number") {
    const numeric = Number(value);
    if (!Number.isNaN(numeric)) return numeric;
  }
  return value;
}

function valueAtPath(state: unknown, path: string): unknown {
  let current: unknown = state;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function snapshotFromState(state: unknown): SettingsSnapshot {
  const snapshot = {} as SettingsSnapshot;
  for (const key of STAGED_SETTING_KEYS) {
    snapshot[key] = normalizeSettingValue(key, valueAtPath(state, key));
  }
  return snapshot;
}

export function diffSnapshots(pristine: SettingsSnapshot, draft: SettingsSnapshot): StagedSettingKey[] {
  return STAGED_SETTING_KEYS.filter(key => !Object.is(pristine[key], draft[key]));
}

// An external store write (another window, the main process) must update the
// pristine baseline without discarding in-progress edits: keys the user has
// not touched follow the incoming value, dirty keys keep the draft.
export function mergeExternalState(
  pristine: SettingsSnapshot,
  draft: SettingsSnapshot,
  incomingState: unknown
): { pristine: SettingsSnapshot; followedKeys: StagedSettingKey[] } {
  const incoming = snapshotFromState(incomingState);
  const followedKeys = STAGED_SETTING_KEYS.filter(key => Object.is(pristine[key], draft[key]) && !Object.is(pristine[key], incoming[key]));
  return { pristine: incoming, followedKeys };
}

export function restartRequiredIn(keys: readonly StagedSettingKey[]): boolean {
  return keys.some(key => RESTART_REQUIRED_KEYS.has(key));
}
