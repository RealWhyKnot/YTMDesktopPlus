<script setup lang="ts" generic="T extends 'checkbox' | 'text' | 'file' | 'range' | 'number' | 'select' | 'custom'">
import { computed, ref, useId } from "vue";
import { readIntegerPrefix } from "~shared/integer-prefix";
import ToggleSwitch from "./ToggleSwitch.vue";

type ModelValue = {
  checkbox: boolean;
  text: string;
  file: string;
  range: number;
  number: number;
  custom: never;
  select: number | string;
};

const props = defineProps<{
  type: T;
  modelValue?: ModelValue[T];
  name: string;
  description?: string;
  restartRequired?: boolean;
  indented?: boolean;
  bindSetting?: string;
  max?: number | string;
  min?: number | string;
  step?: number | string;
  disabled?: boolean;
  disabledMessage?: string;
  flexColumn?: boolean;
  beta?: boolean;
  optionsMap?: Record<string, string>;
  valueType?: "string" | "number";
  maxlength?: number | string;
  placeholder?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: boolean | string | number | undefined];
  "file-change": [event: Event];
  change: [event?: Event];
  clear: [];
}>();

const value = computed({
  get() {
    return props.modelValue;
  },
  set(isValue) {
    emit("update:modelValue", isValue);
  },
});

const hasDescription = computed(() => {
  return props.description && props.description.trim() !== "";
});

const fileInput = ref<HTMLInputElement | null>(null);

const labelId = useId();
const descriptionId = useId();
const describedBy = computed(() => (props.disabled ? (props.disabledMessage ? descriptionId : undefined) : hasDescription.value ? descriptionId : undefined));

const checkboxValue = computed({
  get() {
    return typeof props.modelValue === "boolean" ? props.modelValue : undefined;
  },
  set(isValue) {
    emit("update:modelValue", isValue);
  },
});

function selectChanged(event: Event) {
  if (!(event.target instanceof HTMLSelectElement)) return;
  const raw = event.target.value;
  emit("update:modelValue", props.valueType === "string" ? raw : readIntegerPrefix(raw));
  emit("change");
}
</script>

<template>
  <div :class="{ 'ytmd-setting': true, indented: props.indented, 'flex-column': props.flexColumn }">
    <p v-if="!disabled && !hasDescription" :id="labelId">
      {{ name }}
      <span v-if="restartRequired" class="reload-required material-symbols-outlined" role="img" aria-label="Needs a restart" title="Needs a restart"
        >autorenew</span
      >
      <span v-if="beta" class="beta-tag" title="This is a beta feature and may not work correctly yet.">BETA</span>
    </p>
    <div v-else-if="!disabled && hasDescription" class="name-description">
      <p :id="labelId" class="name">
        {{ name }}
        <span v-if="restartRequired" class="reload-required material-symbols-outlined" role="img" aria-label="Needs a restart" title="Needs a restart"
          >autorenew</span
        >
        <span v-if="beta" class="beta-tag" title="This is a beta feature and may not work correctly yet.">BETA</span>
      </p>
      <p :id="descriptionId" class="description">{{ description }}</p>
    </div>
    <div v-if="disabled" class="disabled-name-message">
      <p :id="labelId" class="name">
        <span class="disabled-tag">DISABLED</span> {{ name }}
        <span v-if="restartRequired" class="reload-required material-symbols-outlined" role="img" aria-label="Needs a restart" title="Needs a restart"
          >autorenew</span
        >
        <span v-if="beta" class="beta-tag" title="This is a beta feature and may not work correctly yet.">BETA</span>
      </p>
      <p :id="descriptionId" class="message">{{ disabledMessage }}</p>
    </div>

    <ToggleSwitch
      v-if="type == 'checkbox'"
      v-model="checkboxValue"
      :disabled="disabled"
      :aria-labelledby="labelId"
      :aria-describedby="describedBy"
      @change="$emit('change', $event)"
    />
    <input
      v-if="type == 'text'"
      v-model="value"
      :disabled="disabled"
      :aria-labelledby="labelId"
      :aria-describedby="describedBy"
      type="text"
      :maxlength="props.maxlength"
      :placeholder="props.placeholder"
      @change="$emit('change', $event)"
    />
    <div v-if="type == 'range'" class="range-selector">
      <span class="range-value">{{ value }}</span>
      <input
        v-model="value"
        :disabled="disabled"
        :aria-labelledby="labelId"
        :aria-describedby="describedBy"
        :type="props.type"
        :max="props.max"
        :min="props.min"
        :step="props.step"
        @change="$emit('change', $event)"
      />
    </div>
    <input
      v-if="type == 'number'"
      v-model.number="value"
      :disabled="disabled"
      :aria-labelledby="labelId"
      :aria-describedby="describedBy"
      type="number"
      :max="props.max"
      :min="props.min"
      :step="props.step"
      @change="$emit('change', $event)"
    />
    <div v-if="type == 'file'" class="file-picker">
      <input ref="fileInput" :disabled="disabled" type="file" accept=".css" :data-setting="bindSetting" @change="$emit('file-change', $event)" />
      <div class="file-input-button">
        <button class="choose" @click="fileInput?.click()"><span class="material-symbols-outlined">file_open</span></button>
        <input :disabled="disabled" type="text" readonly class="path" placeholder="No file chosen" :value="value" />
        <button v-if="value" class="remove" @click="$emit('clear')"><span class="material-symbols-outlined">delete</span></button>
      </div>
    </div>
    <select
      v-if="type == 'select'"
      class="select"
      :disabled="disabled"
      :aria-labelledby="labelId"
      :aria-describedby="describedBy"
      :value="String(modelValue)"
      @change="selectChanged"
    >
      <option v-for="(optionValue, optionKey) of props.optionsMap" :key="optionKey" :value="String(optionKey)">{{ optionValue }}</option>
    </select>

    <slot></slot>
  </div>
</template>

<style scoped>
.ytmd-setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm) 12px;
  flex-wrap: wrap;
}

.name-description {
  min-width: 0;
  flex: 1 1 240px;
  overflow-wrap: anywhere;
}

.disabled-name-message {
  min-width: 0;
  flex: 1 1 240px;
  overflow-wrap: anywhere;
}

.reload-required {
  vertical-align: middle;
}

.file-picker {
  background-color: var(--bg-control);
  border-radius: var(--radius);
}

.file-input-button {
  width: 216px;
  max-width: 100%;
  border-radius: var(--radius);
  display: flex;
  align-items: center;
}

.range-value {
  display: inline-block;
  min-width: 3ch;
  text-align: right;
  font-variant-numeric: tabular-nums;
  vertical-align: top;
  margin-right: 8px;
}

.select {
  width: 216px;
  max-width: 100%;
  background-color: var(--bg-control);
  color: var(--text);
  border: none;
  border-radius: var(--radius);
  padding: 8px;
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
  outline: 2px solid transparent;
}

.ytmd-setting > p {
  min-width: 0;
  flex: 1 1 240px;
  overflow-wrap: anywhere;
}

input[type="text"] {
  background-color: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--bg-control-hover);
  border-radius: var(--radius);
  padding: 8px 10px;
  outline: 2px solid transparent;
  width: 216px;
  max-width: 100%;
}

input[type="number"] {
  background-color: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--bg-control-hover);
  border-radius: var(--radius);
  padding: 8px 10px;
  outline: 2px solid transparent;
  width: 90px;
  max-width: 100%;
}

input[type="file"] {
  display: none;
}

.file-input-button button {
  padding: 8px;
  border: none;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.file-input-button p {
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

input[type="range"] {
  appearance: none;
  height: 15px;
  border-radius: var(--radius);
  background: var(--bg-control);
  outline: 2px solid transparent;
}

input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
}

.ytmd-setting.indented {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid var(--border);
}

.ytmd-setting.flex-column {
  flex-direction: column;
  align-items: initial;
  justify-content: initial;
}

.ytmd-setting .beta-tag {
  background-color: var(--accent);
  border-radius: var(--radius);
  padding: 2px 4px;
}

.ytmd-setting .disabled-tag {
  background-color: var(--bg-control);
  border-radius: var(--radius);
  padding: 2px 4px;
}

.name-description .name {
  margin-bottom: unset;
}

.disabled-name-message .name {
  margin-bottom: unset;
}

.name-description .description {
  margin-top: 4px;
  color: var(--text-faint);
}

.disabled-name-message .message {
  margin-top: 4px;
  color: var(--text-faint);
}

.select:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.select:disabled {
  cursor: not-allowed;
  color: var(--text-faint);
}

input[type="text"]:focus-within {
  border-color: var(--border-strong);
}

input[type="text"]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

input[type="number"]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

input[type="range"]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.file-input-button button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

input[type="number"]:focus-within {
  border-color: var(--border-strong);
}

.file-input-button .choose {
  background-color: var(--accent);
  border-radius: 4px 0 0 4px;
}

.file-input-button .remove {
  background-color: transparent;
  border-left: 1px solid var(--bg-control-hover);
  border-radius: 0 4px 4px 0;
}

.file-input-button button .material-symbols-outlined {
  margin-right: 4px;
  font-size: calc(18rem / var(--font-size-reference));
}

.file-input-button input[type="text"] {
  margin: 0;
  padding: 8px;
  width: 100%;
  border: none;
  background-color: transparent;
}

.file-input-button input[type="text"]:focus-within {
  outline: 2px solid transparent;
}

.file-input-button input[type="text"]:active {
  outline: 2px solid transparent;
}
</style>
