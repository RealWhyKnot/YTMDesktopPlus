import { computed, inject, ref, shallowReactive, shallowRef, type ComputedRef, type InjectionKey, type Ref, type WritableComputedRef } from "vue";
import {
  RESTART_REQUIRED_KEYS,
  STAGED_SETTING_KEYS,
  type SettingsSnapshot,
  diffSnapshots,
  mergeExternalState,
  normalizeSettingValue,
  snapshotFromState,
} from "~shared/settings-staging";

export type StagedSettings = {
  refs: Record<string, Ref<unknown>>;
  getRef: (key: string) => Ref<unknown>;
  modelBoolean: (key: string) => WritableComputedRef<boolean | undefined>;
  modelNumber: (key: string) => WritableComputedRef<number | undefined>;
  modelText: (key: string) => WritableComputedRef<string | undefined>;
  modelSelection: (key: string) => WritableComputedRef<string | number | undefined>;
  dirtyKeys: ComputedRef<string[]>;
  hasUnsavedChanges: ComputedRef<boolean>;
  restartNeeded: Ref<boolean>;
  stageChanged: () => void;
  saveChanges: () => void;
  resetChanges: () => void;
  applyExternalState: (newState: unknown) => void;

  markSavedValue: (key: string, value: unknown) => void;
  savedValue: (key: string) => unknown;

  addKeys: (keys: readonly string[], state: unknown) => void;
};

export const stagedSettingsKey: InjectionKey<StagedSettings> = Symbol("staged-settings");

export function useStagedSettings(): StagedSettings {
  const staged = inject(stagedSettingsKey);
  if (staged === undefined) throw new Error("Settings provider is missing");
  return staged;
}

export function createStagedSettings(
  initialState: unknown,
  setMany: (entries: [string, unknown][]) => void,
  extraKeys: readonly string[] = []
): StagedSettings {
  const dynamicKeys: string[] = [...extraKeys];
  const allKeys: string[] = [...STAGED_SETTING_KEYS, ...dynamicKeys];
  const pristineRef = shallowRef<SettingsSnapshot>(snapshotFromState(initialState, dynamicKeys));

  const refs = shallowReactive<Record<string, Ref<unknown>>>({});
  for (const key of allKeys) {
    refs[key] = ref<unknown>(pristineRef.value[key]);
  }

  function getRef(key: string): Ref<unknown> {
    const field = refs[key];
    if (field === undefined) throw new Error(`Setting ${key} is not registered`);
    return field;
  }

  function model<T>(key: string, isValue: (value: unknown) => value is T): WritableComputedRef<T | undefined> {
    const field = getRef(key);
    return computed({
      get() {
        const value = field.value;
        if (value === undefined || isValue(value)) return value;
        throw new Error(`Setting ${key} has an invalid value`);
      },
      set(value) {
        field.value = value;
      },
    });
  }

  const modelBoolean = (key: string) => model(key, (value): value is boolean => typeof value === "boolean");
  const modelNumber = (key: string) => model(key, (value): value is number => typeof value === "number");
  const modelText = (key: string) => model(key, (value): value is string => typeof value === "string");
  const modelSelection = (key: string) => model(key, (value): value is string | number => typeof value === "string" || typeof value === "number");

  const launchRestartValues: Partial<SettingsSnapshot> = {};
  for (const key of RESTART_REQUIRED_KEYS) {
    launchRestartValues[key] = pristineRef.value[key];
  }

  const dirtyKeys = computed(() => diffSnapshots(pristineRef.value, draftSnapshot(), dynamicKeys));
  const hasUnsavedChanges = computed(() => dirtyKeys.value.length > 0);
  const restartNeeded = ref(false);

  function draftSnapshot(): SettingsSnapshot {
    return Object.fromEntries(allKeys.map((key) => [key, normalizeSettingValue(key, getRef(key).value)]));
  }

  function stageChanged() {
    return undefined;
  }

  function updateRestartNeeded() {
    restartNeeded.value = [...RESTART_REQUIRED_KEYS].some((key) => !Object.is(pristineRef.value[key], launchRestartValues[key]));
  }

  function saveChanges() {
    const draft = draftSnapshot();
    const changed = diffSnapshots(pristineRef.value, draft, dynamicKeys);
    if (changed.length > 0) {
      setMany(changed.map((key) => [key, draft[key]] as [string, unknown]));
    }
    pristineRef.value = { ...draft };
    updateRestartNeeded();
  }

  function resetChanges() {
    for (const key of allKeys) {
      getRef(key).value = pristineRef.value[key];
    }
  }

  function applyExternalState(newState: unknown) {
    const merged = mergeExternalState(pristineRef.value, draftSnapshot(), newState, dynamicKeys);
    pristineRef.value = merged.pristine;
    for (const key of merged.followedKeys) {
      getRef(key).value = merged.pristine[key];
    }
    updateRestartNeeded();
  }

  function markSavedValue(key: string, value: unknown) {
    pristineRef.value = { ...pristineRef.value, [key]: value };
    getRef(key).value = value;
  }

  function savedValue(key: string): unknown {
    return pristineRef.value[key];
  }

  function addKeys(keys: readonly string[], state: unknown) {
    const fresh = keys.filter((key) => !(key in refs));
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
    getRef,
    modelBoolean,
    modelNumber,
    modelText,
    modelSelection,
    dirtyKeys,
    hasUnsavedChanges,
    restartNeeded,
    stageChanged,
    saveChanges,
    resetChanges,
    applyExternalState,
    markSavedValue,
    savedValue,
    addKeys,
  };
}
