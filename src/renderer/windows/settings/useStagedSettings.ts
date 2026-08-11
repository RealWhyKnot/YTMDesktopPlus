import { computed, ref, type ComputedRef, type InjectionKey, type Ref } from "vue";
import {
  RESTART_REQUIRED_KEYS,
  STAGED_SETTING_KEYS,
  SettingsSnapshot,
  diffSnapshots,
  mergeExternalState,
  normalizeSettingValue,
  snapshotFromState
} from "~shared/settings-staging";

// Draft values for every staged key. Nothing here reaches the store until an
// explicit save writes the dirty keys in one batch.
export interface StagedSettings {
  /** Static app keys plus any dynamic addon keys ("addons.settings.<id>.<key>") */
  refs: Record<string, Ref<unknown>>;
  dirtyKeys: Ref<string[]>;
  hasUnsavedChanges: ComputedRef<boolean>;
  restartNeeded: Ref<boolean>;
  stageChanged(): void;
  saveChanges(): void;
  resetChanges(): void;
  applyExternalState(newState: unknown): void;
  /** For flows that write the store directly (like a Last.fm logout): moves the
   *  saved baseline and the draft together so the key does not read as dirty. */
  markSavedValue(key: string, value: unknown): void;
}

export const stagedSettingsKey: InjectionKey<StagedSettings> = Symbol("staged-settings");

export function createStagedSettings(
  initialState: unknown,
  setMany: (entries: [string, unknown][]) => void,
  extraKeys: readonly string[] = []
): StagedSettings {
  const allKeys: readonly string[] = [...STAGED_SETTING_KEYS, ...extraKeys];
  let pristine: SettingsSnapshot = snapshotFromState(initialState, extraKeys);

  const refs = {} as Record<string, Ref<unknown>>;
  for (const key of allKeys) {
    refs[key] = ref<unknown>(pristine[key]);
  }

  // Restart is needed when a restart-required key's saved value differs from
  // the value this window opened with.
  const launchRestartValues: Partial<SettingsSnapshot> = {};
  for (const key of RESTART_REQUIRED_KEYS) {
    launchRestartValues[key] = pristine[key];
  }

  const dirtyKeys = ref<string[]>([]);
  const hasUnsavedChanges = computed(() => dirtyKeys.value.length > 0);
  const restartNeeded = ref(false);

  function draftSnapshot(): SettingsSnapshot {
    const draft = {} as SettingsSnapshot;
    for (const key of allKeys) {
      draft[key] = normalizeSettingValue(key, refs[key].value);
    }
    return draft;
  }

  function stageChanged() {
    dirtyKeys.value = diffSnapshots(pristine, draftSnapshot(), extraKeys);
  }

  function updateRestartNeeded() {
    restartNeeded.value = [...RESTART_REQUIRED_KEYS].some(key => !Object.is(pristine[key], launchRestartValues[key]));
  }

  function saveChanges() {
    const draft = draftSnapshot();
    const changed = diffSnapshots(pristine, draft, extraKeys);
    if (changed.length > 0) {
      setMany(changed.map(key => [key, draft[key]] as [string, unknown]));
    }
    pristine = { ...draft };
    dirtyKeys.value = [];
    updateRestartNeeded();
  }

  function resetChanges() {
    for (const key of allKeys) {
      refs[key].value = pristine[key];
    }
    dirtyKeys.value = [];
  }

  function applyExternalState(newState: unknown) {
    const merged = mergeExternalState(pristine, draftSnapshot(), newState, extraKeys);
    pristine = merged.pristine;
    for (const key of merged.followedKeys) {
      refs[key].value = pristine[key];
    }
    dirtyKeys.value = diffSnapshots(pristine, draftSnapshot(), extraKeys);
    updateRestartNeeded();
  }

  function markSavedValue(key: string, value: unknown) {
    pristine = { ...pristine, [key]: value };
    refs[key].value = value;
    dirtyKeys.value = diffSnapshots(pristine, draftSnapshot(), extraKeys);
  }

  return { refs, dirtyKeys, hasUnsavedChanges, restartNeeded, stageChanged, saveChanges, resetChanges, applyExternalState, markSavedValue };
}
