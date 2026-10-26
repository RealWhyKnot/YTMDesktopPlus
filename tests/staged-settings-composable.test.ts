import { describe, expect, it, vi } from "vitest";
import { computed } from "vue";
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
      companionServerLANEnabled: false,
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

  it("adds late keys clean, editable and saved like any other", () => {
    const setMany = vi.fn();
    const staged = createStagedSettings(stateFixture(), setMany);

    staged.addKeys(["addons.settings.late.mode"], { addons: { settings: { late: { mode: 2 } } } });
    expect(staged.refs["addons.settings.late.mode"].value).toBe(2);
    expect(staged.hasUnsavedChanges.value).toBe(false);

    staged.refs["addons.settings.late.mode"].value = 5;
    staged.stageChanged();
    expect(staged.dirtyKeys.value).toEqual(["addons.settings.late.mode"]);

    staged.saveChanges();
    expect(setMany).toHaveBeenCalledWith([["addons.settings.late.mode", 5]]);
  });

  it("late keys keep drafts through external state updates and ignore duplicates", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    staged.addKeys(["addons.settings.late.mode"], { addons: { settings: { late: { mode: 1 } } } });

    staged.refs["addons.settings.late.mode"].value = 9;
    staged.stageChanged();

    // A second add of the same key must not reset the draft.
    staged.addKeys(["addons.settings.late.mode"], { addons: { settings: { late: { mode: 1 } } } });
    expect(staged.refs["addons.settings.late.mode"].value).toBe(9);

    // An external write to an untouched late key follows; the dirty one keeps its draft.
    staged.applyExternalState({ ...stateFixture(), addons: { settings: { late: { mode: 3 } } } });
    expect(staged.refs["addons.settings.late.mode"].value).toBe(9);
    expect(staged.dirtyKeys.value).toEqual(["addons.settings.late.mode"]);
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

  it("follows the draft without waiting for a change event", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    staged.refs["shortcuts.next"].value = "CmdOrCtrl+N";
    expect(staged.dirtyKeys.value).toEqual(["shortcuts.next"]);
    expect(staged.hasUnsavedChanges.value).toBe(true);

    staged.refs["shortcuts.next"].value = "";
    expect(staged.hasUnsavedChanges.value).toBe(false);
  });

  it("exposes the saved value of a key separately from its draft", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    staged.refs["appearance.zoom"].value = 150;
    expect(staged.savedValue("appearance.zoom")).toBe(100);
    staged.saveChanges();
    expect(staged.savedValue("appearance.zoom")).toBe(150);
  });

  it("makes late keys visible to reactive readers", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    const present = computed(() => "addons.settings.late.mode" in staged.refs);
    expect(present.value).toBe(false);
    staged.addKeys(["addons.settings.late.mode"], { addons: { settings: { late: { mode: 1 } } } });
    expect(present.value).toBe(true);
  });

  it("markSavedValue moves the baseline without leaving the key dirty", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    staged.markSavedValue("integrations.lastFMEnabled", false);
    expect(staged.refs["integrations.lastFMEnabled"].value).toBe(false);
    expect(staged.hasUnsavedChanges.value).toBe(false);
  });

  it("stages the companion LAN toggle like the other companion settings", () => {
    const staged = createStagedSettings(stateFixture(), () => {});
    expect(staged.refs["integrations.companionServerLANEnabled"].value).toBe(false);
    staged.refs["integrations.companionServerLANEnabled"].value = true;
    expect(staged.dirtyKeys.value).toEqual(["integrations.companionServerLANEnabled"]);
  });
});
