import { computed, ref, type ComputedRef, type InjectionKey, type Ref } from "vue";
import {
  RESTART_REQUIRED_KEYS,
  STAGED_SETTING_KEYS,
  SettingsSnapshot,
  StagedSettingKey,
  diffSnapshots,
  mergeExternalState,
  normalizeSettingValue,
  snapshotFromState
} from "~shared/settings-staging";

// Draft values for every staged key. Nothing here reaches the store until an
// explicit save writes the dirty keys in one batch.
export interface StagedSettings {
  refs: Record<StagedSettingKey, Ref<unknown>>;
  dirtyKeys: Ref<StagedSettingKey[]>;
  hasUnsavedChanges: ComputedRef<boolean>;
  restartNeeded: Ref<boolean>;
  stageChanged(): void;
  saveChanges(): void;
  resetChanges(): void;
  applyExternalState(newState: unknown): void;
  /** For flows that write the store directly (like a Last.fm logout): moves the
   *  saved baseline and the draft together so the key does not read as dirty. */
  markSavedValue(key: StagedSettingKey, value: unknown): void;
}

export const stagedSettingsKey: InjectionKey<StagedSettings> = Symbol("staged-settings");

export function createStagedSettings(initialState: unknown, setMany: (entries: [string, unknown][]) => void): StagedSettings {
  let pristine: SettingsSnapshot = snapshotFromState(initialState);

  const refs = {} as Record<StagedSettingKey, Ref<unknown>>;
  for (const key of STAGED_SETTING_KEYS) {
    refs[key] = ref<unknown>(pristine[key]);
  }

  // Restart is needed when a restart-required key's saved value differs from
  // the value this window opened with.
  const launchRestartValues: Partial<SettingsSnapshot> = {};
  for (const key of RESTART_REQUIRED_KEYS) {
    launchRestartValues[key] = pristine[key];
  }

  const dirtyKeys = ref<StagedSettingKey[]>([]);
  const hasUnsavedChanges = computed(() => dirtyKeys.value.length > 0);
  const restartNeeded = ref(false);

  function draftSnapshot(): SettingsSnapshot {
    const draft = {} as SettingsSnapshot;
    for (const key of STAGED_SETTING_KEYS) {
      draft[key] = normalizeSettingValue(key, refs[key].value);
    }
    return draft;
  }

  function stageChanged() {
    dirtyKeys.value = diffSnapshots(pristine, draftSnapshot());
  }

  function updateRestartNeeded() {
    restartNeeded.value = [...RESTART_REQUIRED_KEYS].some(key => !Object.is(pristine[key], launchRestartValues[key]));
  }

  function saveChanges() {
    const draft = draftSnapshot();
    const changed = diffSnapshots(pristine, draft);
    if (changed.length > 0) {
      setMany(changed.map(key => [key, draft[key]] as [string, unknown]));
    }
    pristine = { ...draft };
    dirtyKeys.value = [];
    updateRestartNeeded();
  }

  function resetChanges() {
    for (const key of STAGED_SETTING_KEYS) {
      refs[key].value = pristine[key];
    }
    dirtyKeys.value = [];
  }

  function applyExternalState(newState: unknown) {
    const merged = mergeExternalState(pristine, draftSnapshot(), newState);
    pristine = merged.pristine;
    for (const key of merged.followedKeys) {
      refs[key].value = pristine[key];
    }
    dirtyKeys.value = diffSnapshots(pristine, draftSnapshot());
    updateRestartNeeded();
  }

  function markSavedValue(key: StagedSettingKey, value: unknown) {
    pristine = { ...pristine, [key]: value };
    refs[key].value = value;
    dirtyKeys.value = diffSnapshots(pristine, draftSnapshot());
  }

  return { refs, dirtyKeys, hasUnsavedChanges, restartNeeded, stageChanged, saveChanges, resetChanges, applyExternalState, markSavedValue };
}
