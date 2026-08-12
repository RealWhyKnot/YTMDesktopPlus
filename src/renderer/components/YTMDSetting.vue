<script setup lang="ts" generic="T extends 'checkbox' | 'text' | 'file' | 'range' | 'number' | 'select' | 'custom'">
import { computed, ref } from "vue";
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
  bindSetting?: string; // This is for the file picker so that it can properly set a data attribute that binds the setting correctly. TODO: Rewrite to not have this
  max?: number | string;
  min?: number | string;
  step?: number | string;
  disabled?: boolean;
  disabledMessage?: string;
  flexColumn?: boolean;
  beta?: boolean;
  optionsMap?: { [key: string]: string }; // This is for the select menu
  valueType?: "string" | "number"; // How select option values read back; numbers by default
  maxlength?: number | string; // This is for the text input
  placeholder?: string; // This is for the text input
}>();
const emit = defineEmits(["update:modelValue", "file-change", "change", "clear"]);

const value = computed({
  get() {
    return props.modelValue;
  },
  set(value) {
    emit("update:modelValue", value);
  }
});

const hasDescription = computed(() => {
  return props.description && props.description.trim() !== "";
});

const fileInput = ref(null);

const checkboxValue = computed({
  get() {
    return props.modelValue as boolean;
  },
  set(value) {
    emit("update:modelValue", value);
  }
});

function selectChanged(event: Event) {
  const raw = (event.target as HTMLSelectElement).value;
  value.value = (props.valueType === "string" ? raw : Number.parseInt(raw)) as ModelValue[T];
  emit("change");
}
</script>

<template>
  <div :class="{ 'ytmd-setting': true, 'indented': props.indented, 'flex-column': props.flexColumn }">
    <p v-if="!disabled && !hasDescription">
      {{ name }} <span v-if="restartRequired" class="reload-required material-symbols-outlined">autorenew</span>
      <span v-if="beta" class="beta-tag" title="This is a beta feature and may not work correctly yet.">BETA</span>
    </p>
    <div v-else-if="!disabled && hasDescription" class="name-description">
      <p class="name">
        {{ name }} <span v-if="restartRequired" class="reload-required material-symbols-outlined">autorenew</span>
        <span v-if="beta" class="beta-tag" title="This is a beta feature and may not work correctly yet.">BETA</span>
      </p>
      <p class="description">{{ description }}</p>
    </div>
    <div v-if="disabled" class="disabled-name-message">
      <p class="name">
        <span class="disabled-tag">DISABLED</span> {{ name }} <span v-if="restartRequired" class="reload-required material-symbols-outlined">autorenew</span>
        <span v-if="beta" class="beta-tag" title="This is a beta feature and may not work correctly yet.">BETA</span>
      </p>
      <p class="message">{{ disabledMessage }}</p>
    </div>

    <ToggleSwitch v-if="type == 'checkbox'" v-model="checkboxValue" :disabled="disabled" @change="$emit('change', $event)" />
    <input
      v-if="type == 'text'"
      v-model="value"
      :disabled="disabled"
      type="text"
      :maxlength="props.maxlength"
      :placeholder="props.placeholder"
      @change="$emit('change', $event)"
    />
    <div v-if="type == 'range'" class="range-selector">
      <span class="range-value">{{ value }}</span>
      <input v-model="value" :disabled="disabled" :type="props.type" :max="props.max" :min="props.min" :step="props.step" @change="$emit('change', $event)" />
    </div>
    <input
      v-if="type == 'number'"
      v-model.number="value"
      :disabled="disabled"
      type="number"
      :max="props.max"
      :min="props.min"
      :step="props.step"
      @change="$emit('change', $event)"
    />
    <div v-if="type == 'file'" class="file-picker">
      <input ref="fileInput" :disabled="disabled" type="file" accept=".css" :data-setting="bindSetting" @change="$emit('file-change', $event)" />
      <div class="file-input-button">
        <button class="choose" @click="fileInput.click()"><span class="material-symbols-outlined">file_open</span></button>
        <input :disabled="disabled" type="text" readonly class="path" placeholder="No file chosen" :value="value" />
        <button v-if="value" class="remove" @click="$emit('clear')"><span class="material-symbols-outlined">delete</span></button>
      </div>
    </div>
    <select v-if="type == 'select'" class="select" :disabled="disabled" :value="String(modelValue)" @change="selectChanged">
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

/* Let long labels shrink and wrap instead of colliding with the control */
.ytmd-setting > p,
.name-description,
.disabled-name-message {
  min-width: 0;
  flex: 1 1 240px;
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

.name-description .name,
.disabled-name-message .name {
  margin-bottom: unset;
}

.name-description .description,
.disabled-name-message .message {
  margin-top: 4px;
  color: var(--text-faint);
}

.reload-required {
  vertical-align: middle;
}

input[type="text"] {
  background-color: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--bg-control-hover);
  border-radius: var(--radius);
  padding: 8px 10px;
  outline: none;
  width: 216px;
  max-width: 100%;
}

input[type="text"]:focus {
  border-color: var(--border-strong);
}

input[type="number"] {
  background-color: var(--bg-raised);
  color: var(--text);
  border: 1px solid var(--bg-control-hover);
  border-radius: var(--radius);
  padding: 8px 10px;
  outline: none;
  width: 90px;
  max-width: 100%;
}

input[type="number"]:focus {
  border-color: var(--border-strong);
}

input[type="file"] {
  display: none;
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

.file-input-button button {
  padding: 8px;
  border: none;
  display: flex;
  align-items: center;
  cursor: pointer;
}

.file-input-button button.choose {
  background-color: var(--accent);
  border-radius: 4px 0 0 4px;
}

.file-input-button button.remove {
  background-color: transparent;
  border-left: 1px solid var(--bg-control-hover);
  border-radius: 0 4px 4px 0;
}

.file-input-button button .material-symbols-outlined {
  margin-right: 4px;
  font-size: 18px;
}

.file-input-button input[type="text"] {
  margin: 0;
  padding: 8px;
  width: 100%;
  border: none;
  background-color: transparent;
}

.file-input-button input[type="text"]:focus,
.file-input-button input[type="text"]:active {
  outline: none;
}

.file-input-button p {
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.range-value {
  vertical-align: top;
  margin-right: 8px;
}

input[type="range"] {
  appearance: none;
  height: 15px;
  border-radius: var(--radius);
  background: var(--bg-control);
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
}

/* Native select so the option list pops above the window instead of being
   clipped by the tab's scroll container */
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
  outline: none;
}

.select:disabled {
  cursor: not-allowed;
  color: var(--text-faint);
}
</style>
