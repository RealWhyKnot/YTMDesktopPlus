export const STAGED_SETTING_KEYS = [
  "general.hideToTrayOnClose",
  "general.showNotificationOnSongChange",
  "general.startOnBoot",
  "general.startMinimized",
  "general.disableHardwareAcceleration",
  "developer.debugLogging",
  "appearance.alwaysShowVolumeSlider",
  "appearance.zoom",
  "appearance.trayIconStyle",
  "playback.continueWhereYouLeftOff",
  "playback.continueWhereYouLeftOffPaused",
  "playback.progressInTaskbar",
  "playback.enableSpeakerFill",
  "playback.ratioVolume",
  "playback.adBlockerEnabled",
  "playback.preventIdlePause",
  "integrations.companionServerEnabled",
  "integrations.companionServerCORSWildcardEnabled",
  "integrations.companionServerLANEnabled",
  "integrations.discordPresenceEnabled",
  "integrations.discordPresenceHideOnPause",
  "integrations.lastFMEnabled",
  "lastfm.scrobblePercent",
  "shortcuts.playPause",
  "shortcuts.next",
  "shortcuts.previous",
  "shortcuts.thumbsUp",
  "shortcuts.thumbsDown",
  "shortcuts.volumeUp",
  "shortcuts.volumeDown",
  "updates.autoUpdateEnabled",
  "updates.channel",
] as const;

export type StagedSettingKey = (typeof STAGED_SETTING_KEYS)[number];

export type SettingsSnapshot = Record<string, unknown>;

export const RESTART_REQUIRED_KEYS: ReadonlySet<StagedSettingKey> = new Set<StagedSettingKey>([
  "general.disableHardwareAcceleration",
  "playback.enableSpeakerFill",
]);

const NUMERIC_KEYS: ReadonlySet<string> = new Set<StagedSettingKey>([
  "appearance.zoom",
  "appearance.trayIconStyle",
  "lastfm.scrobblePercent",
  "updates.channel",
]);

export function normalizeSettingValue(key: string, value: unknown): unknown {
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
    current = Reflect.get(current, part);
  }
  return current;
}

export function snapshotFromState(state: unknown, extraKeys: readonly string[] = []): SettingsSnapshot {
  const snapshot = new Map<string, unknown>();
  for (const key of [...STAGED_SETTING_KEYS, ...extraKeys]) {
    snapshot.set(key, normalizeSettingValue(key, valueAtPath(state, key)));
  }
  return Object.fromEntries(snapshot);
}

export function diffSnapshots(pristine: SettingsSnapshot, draft: SettingsSnapshot, extraKeys: readonly string[] = []): string[] {
  return [...STAGED_SETTING_KEYS, ...extraKeys].filter((key) => !Object.is(pristine[key], draft[key]));
}

export function mergeExternalState(
  pristine: SettingsSnapshot,
  draft: SettingsSnapshot,
  incomingState: unknown,
  extraKeys: readonly string[] = []
): { pristine: SettingsSnapshot; followedKeys: string[] } {
  const incoming = snapshotFromState(incomingState, extraKeys);
  const followedKeys = [...STAGED_SETTING_KEYS, ...extraKeys].filter((key) => Object.is(pristine[key], draft[key]) && !Object.is(pristine[key], incoming[key]));
  return { pristine: incoming, followedKeys };
}

export function restartRequiredIn(keys: readonly string[]): boolean {
  return keys.some((key) => [...RESTART_REQUIRED_KEYS].some((required) => required === key));
}
