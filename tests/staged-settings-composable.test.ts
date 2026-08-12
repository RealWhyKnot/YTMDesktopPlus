import { describe, expect, it, vi } from "vitest";
import { createStagedSettings } from "../src/renderer/windows/settings/useStagedSettings";

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
    appearance: { alwaysShowVolumeSlider: false, zoom: 100, trayIconStyle: 0 },
    playback: {
      continueWhereYouLeftOff: true,
      continueWhereYouLeftOffPaused: true,
      progressInTaskbar: false,
      enableSpeakerFill: false,
      ratioVolume: false,
      adBlockerEnabled: false,
      preventIdlePause: false
    },
    integrations: {
      companionServerEnabled: false,
      companionServerCORSWildcardEnabled: false,
      discordPresenceEnabled: true,
      discordPresenceHideOnPause: false,
      lastFMEnabled: true
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

describe("createStagedSettings", () => {
  // The window must open clean; a key missing from the pristine snapshot
  // (like the updates section once was) reads as an immediate unsaved change.
  it("opens with no unsaved changes", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    expect(staged.hasUnsavedChanges.value).toBe(false);
    expect(staged.dirtyKeys.value).toEqual([]);
  });

  it("tracks edits and writes only the dirty keys on save", () => {
    const setMany = vi.fn();
    const staged = createStagedSettings(stateFixture(), setMany);

    staged.refs["general.startOnBoot"].value = true;
    staged.stageChanged();
    expect(staged.dirtyKeys.value).toEqual(["general.startOnBoot"]);

    staged.saveChanges();
    expect(setMany).toHaveBeenCalledWith([["general.startOnBoot", true]]);
    expect(staged.hasUnsavedChanges.value).toBe(false);
  });

  it("reset restores the pristine values", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    staged.refs["appearance.zoom"].value = 200;
    staged.stageChanged();
    staged.resetChanges();
    expect(staged.refs["appearance.zoom"].value).toBe(100);
    expect(staged.hasUnsavedChanges.value).toBe(false);
  });

  it("flags a restart only when a restart-required key changes from its launch value", () => {
    const setMany = vi.fn();
    const staged = createStagedSettings(stateFixture(), setMany);

    staged.refs["general.disableHardwareAcceleration"].value = true;
    staged.stageChanged();
    expect(staged.restartNeeded.value).toBe(false);

    staged.saveChanges();
    expect(staged.restartNeeded.value).toBe(true);

    staged.refs["general.disableHardwareAcceleration"].value = false;
    staged.stageChanged();
    staged.saveChanges();
    expect(staged.restartNeeded.value).toBe(false);
  });

  it("external writes follow untouched keys and keep dirty drafts", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    staged.refs["general.startOnBoot"].value = true;
    staged.stageChanged();

    staged.applyExternalState(stateFixture({ "developer.debugLogging": true }));
    expect(staged.refs["developer.debugLogging"].value).toBe(true);
    expect(staged.refs["general.startOnBoot"].value).toBe(true);
    expect(staged.dirtyKeys.value).toEqual(["general.startOnBoot"]);
  });

  it("markSavedValue moves the baseline without leaving the key dirty", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    staged.markSavedValue("integrations.lastFMEnabled", false);
    expect(staged.refs["integrations.lastFMEnabled"].value).toBe(false);
    expect(staged.hasUnsavedChanges.value).toBe(false);
  });
});
