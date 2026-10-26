import { computed, ref, shallowReactive, shallowRef, type ComputedRef, type InjectionKey, type Ref } from "vue";
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
  dirtyKeys: ComputedRef<string[]>;
  hasUnsavedChanges: ComputedRef<boolean>;
  restartNeeded: Ref<boolean>;
  stageChanged(): void;
  saveChanges(): void;
  resetChanges(): void;
  applyExternalState(newState: unknown): void;
  /** For flows that write the store directly (like a Last.fm logout): moves the
   *  saved baseline and the draft together so the key does not read as dirty. */
  markSavedValue(key: string, value: unknown): void;
  savedValue(key: string): unknown;
  /** Staged keys discovered after this window opened (an addon registering its
   *  settings UI late). New keys snapshot their value from the given state and
   *  start clean; keys already present are untouched. */
  addKeys(keys: readonly string[], state: unknown): void;
}

export const stagedSettingsKey: InjectionKey<StagedSettings> = Symbol("staged-settings");

export function createStagedSettings(
  initialState: unknown,
  setMany: (entries: [string, unknown][]) => void,
  extraKeys: readonly string[] = []
): StagedSettings {
  const dynamicKeys: string[] = [...extraKeys];
  const allKeys: string[] = [...STAGED_SETTING_KEYS, ...dynamicKeys];
  const pristineRef = shallowRef<SettingsSnapshot>(snapshotFromState(initialState, dynamicKeys));

  const refs = shallowReactive({} as Record<string, Ref<unknown>>);
  for (const key of allKeys) {
    refs[key] = ref<unknown>(pristineRef.value[key]);
  }

  // Restart is needed when a restart-required key's saved value differs from
  // the value this window opened with.
  const launchRestartValues: Partial<SettingsSnapshot> = {};
  for (const key of RESTART_REQUIRED_KEYS) {
    launchRestartValues[key] = pristineRef.value[key];
  }

  const dirtyKeys = computed(() => diffSnapshots(pristineRef.value, draftSnapshot(), dynamicKeys));
  const hasUnsavedChanges = computed(() => dirtyKeys.value.length > 0);
  const restartNeeded = ref(false);

  function draftSnapshot(): SettingsSnapshot {
    const draft = {} as SettingsSnapshot;
    for (const key of allKeys) {
      draft[key] = normalizeSettingValue(key, refs[key].value);
    }
    return draft;
  }

  function stageChanged() {}

  function updateRestartNeeded() {
    restartNeeded.value = [...RESTART_REQUIRED_KEYS].some(key => !Object.is(pristineRef.value[key], launchRestartValues[key]));
  }

  function saveChanges() {
    const draft = draftSnapshot();
    const changed = diffSnapshots(pristineRef.value, draft, dynamicKeys);
    if (changed.length > 0) {
      setMany(changed.map(key => [key, draft[key]] as [string, unknown]));
    }
    pristineRef.value = { ...draft };
    updateRestartNeeded();
  }

  function resetChanges() {
    for (const key of allKeys) {
      refs[key].value = pristineRef.value[key];
    }
  }

  function applyExternalState(newState: unknown) {
    const merged = mergeExternalState(pristineRef.value, draftSnapshot(), newState, dynamicKeys);
    pristineRef.value = merged.pristine;
    for (const key of merged.followedKeys) {
      refs[key].value = merged.pristine[key];
    }
    updateRestartNeeded();
  }

  function markSavedValue(key: string, value: unknown) {
    pristineRef.value = { ...pristineRef.value, [key]: value };
    refs[key].value = value;
  }

  function savedValue(key: string): unknown {
    return pristineRef.value[key];
  }

  function addKeys(keys: readonly string[], state: unknown) {
    const fresh = keys.filter(key => !(key in refs));
    if (fresh.length === 0) return;
    const snapshot = snapshotFromState(state, fresh);
    const next = { ...pristineRef.value };
    for (const key of fresh) {
      dynamicKeys.push(key);
      allKeys.push(key);
      next[key] = snapshot[key];
      refs[key] = ref<unknown>(snapshot[key]);
    }
    pristineRef.value = next;
  }

  return {
    refs,
    dirtyKeys,
    hasUnsavedChanges,
    restartNeeded,
    stageChanged,
    saveChanges,
    resetChanges,
    applyExternalState,
    markSavedValue,
    savedValue,
    addKeys
  };
}
