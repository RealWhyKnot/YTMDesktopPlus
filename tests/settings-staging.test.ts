import { describe, expect, it } from "vitest";
import {
  RESTART_REQUIRED_KEYS,
  STAGED_SETTING_KEYS,
  SettingsSnapshot,
  diffSnapshots,
  mergeExternalState,
  normalizeSettingValue,
  restartRequiredIn,
  snapshotFromState
} from "../src/shared/settings-staging";

function stateFixture(overrides: Record<string, unknown> = {}) {
  const state: Record<string, Record<string, unknown>> = {
    general: {
      hideToTrayOnClose: true,
      showNotificationOnSongChange: false,
      startOnBoot: false,
      startMinimized: false,
      disableHardwareAcceleration: false
    },
    developer: { debugLogging: false },
    appearance: { alwaysShowVolumeSlider: false, customCSSEnabled: false, customCSSPath: null, zoom: 100, trayIconStyle: 0 },
    playback: {
      continueWhereYouLeftOff: true,
      continueWhereYouLeftOffPaused: true,
      progressInTaskbar: false,
      enableSpeakerFill: false,
      ratioVolume: false,
      loudnessNormalization: false
    },
    integrations: {
      companionServerEnabled: false,
      companionServerCORSWildcardEnabled: false,
      discordPresenceEnabled: true,
      lastFMEnabled: false,
      listenAlongRoomsEnabled: true,
      listenAlongDisplayName: null
    },
    lastfm: { scrobblePercent: 50 },
    shortcuts: { playPause: "", next: "", previous: "", thumbsUp: "", thumbsDown: "", volumeUp: "", volumeDown: "" },
    updates: { autoUpdateEnabled: false, channel: 0 }
  };
  for (const [path, value] of Object.entries(overrides)) {
    const [section, key] = path.split(".");
    state[section][key] = value;
  }
  return state;
}

describe("snapshotFromState", () => {
  it("captures every staged key", () => {
    const snapshot = snapshotFromState(stateFixture());
    for (const key of STAGED_SETTING_KEYS) {
      expect(snapshot).toHaveProperty([key]);
    }
    expect(snapshot["general.hideToTrayOnClose"]).toBe(true);
    expect(snapshot["appearance.customCSSPath"]).toBe(null);
  });

  it("tolerates missing sections", () => {
    const snapshot = snapshotFromState({});
    expect(snapshot["general.hideToTrayOnClose"]).toBeUndefined();
  });

  it("normalizes numeric keys delivered as strings", () => {
    const snapshot = snapshotFromState(stateFixture({ "appearance.zoom": "150" }));
    expect(snapshot["appearance.zoom"]).toBe(150);
  });
});

describe("normalizeSettingValue", () => {
  it("converts numeric strings for numeric keys only", () => {
    expect(normalizeSettingValue("appearance.zoom", "90")).toBe(90);
    expect(normalizeSettingValue("lastfm.scrobblePercent", "55")).toBe(55);
    expect(normalizeSettingValue("shortcuts.playPause", "90")).toBe("90");
  });

  it("passes through null and non-numeric values", () => {
    expect(normalizeSettingValue("appearance.zoom", null)).toBe(null);
    expect(normalizeSettingValue("appearance.zoom", "abc")).toBe("abc");
  });
});

describe("diffSnapshots", () => {
  it("returns empty for identical snapshots", () => {
    const snapshot = snapshotFromState(stateFixture());
    expect(diffSnapshots(snapshot, { ...snapshot })).toEqual([]);
  });

  it("returns only the changed keys", () => {
    const pristine = snapshotFromState(stateFixture());
    const draft: SettingsSnapshot = { ...pristine, "general.startOnBoot": true, "appearance.zoom": 120 };
    expect(diffSnapshots(pristine, draft).sort()).toEqual(["appearance.zoom", "general.startOnBoot"]);
  });

  it("treats a string-number draft as equal after normalization upstream", () => {
    const pristine = snapshotFromState(stateFixture());
    const draft = { ...pristine, "appearance.zoom": normalizeSettingValue("appearance.zoom", "100") };
    expect(diffSnapshots(pristine, draft)).toEqual([]);
  });
});

describe("mergeExternalState", () => {
  it("follows external changes on clean keys", () => {
    const pristine = snapshotFromState(stateFixture());
    const draft = { ...pristine };
    const incoming = stateFixture({ "general.startOnBoot": true });
    const merged = mergeExternalState(pristine, draft, incoming);
    expect(merged.followedKeys).toEqual(["general.startOnBoot"]);
    expect(merged.pristine["general.startOnBoot"]).toBe(true);
  });

  it("keeps the draft on dirty keys while updating pristine", () => {
    const pristine = snapshotFromState(stateFixture());
    const draft: SettingsSnapshot = { ...pristine, "general.startOnBoot": true };
    const incoming = stateFixture({ "general.startOnBoot": true });
    const merged = mergeExternalState(pristine, draft, incoming);
    expect(merged.followedKeys).toEqual([]);
    expect(merged.pristine["general.startOnBoot"]).toBe(true);
    // The draft now matches the new pristine, so the key reads clean afterwards.
    expect(diffSnapshots(merged.pristine, draft)).toEqual([]);
  });

  it("does not follow keys that did not change externally", () => {
    const pristine = snapshotFromState(stateFixture());
    const draft: SettingsSnapshot = { ...pristine, "appearance.zoom": 120 };
    const merged = mergeExternalState(pristine, draft, stateFixture());
    expect(merged.followedKeys).toEqual([]);
    expect(diffSnapshots(merged.pristine, draft)).toEqual(["appearance.zoom"]);
  });
});

describe("restartRequiredIn", () => {
  it("flags the restart-required keys", () => {
    expect(restartRequiredIn(["general.disableHardwareAcceleration"])).toBe(true);
    expect(restartRequiredIn(["playback.enableSpeakerFill"])).toBe(true);
    expect(restartRequiredIn(["general.startOnBoot"])).toBe(false);
    expect(restartRequiredIn([])).toBe(false);
  });

  it("matches the exported set", () => {
    expect([...RESTART_REQUIRED_KEYS].every(key => restartRequiredIn([key]))).toBe(true);
  });
});
