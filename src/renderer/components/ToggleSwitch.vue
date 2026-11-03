<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  modelValue?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ "update:modelValue": [isValue: boolean | undefined]; change: [event: Event] }>();

const value = computed({
  get() {
    return props.modelValue;
  },
  set(isValue) {
    emit("update:modelValue", isValue);
  },
});
</script>

<template>
  <input v-model="value" type="checkbox" class="toggle-switch" :disabled="disabled" @change="$emit('change', $event)" />
</template>

<style scoped>
.toggle-switch {
  appearance: none;
  min-width: 62px;
  min-height: 32px;
  width: 62px;
  height: 32px;
  display: inline-block;
  position: relative;
  border-radius: 50px;
  overflow: hidden;
  outline: 2px solid transparent;
  border: none;
  cursor: pointer;
  background-color: var(--bg-control);
  transition: background-color ease 0.3s;
}

.toggle-switch::before {
  content: "";
  display: block;
  position: absolute;
  z-index: var(--layer-toggle-knob);
  width: 28px;
  height: 28px;
  background: var(--knob);
  left: 2px;
  top: 2px;
  border-radius: 50%;
  box-shadow: var(--shadow);
  transition:
    transform ease 0.3s,
    background-color ease 0.3s,
    box-shadow ease 0.3s;
}

.toggle-switch:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.toggle-switch:checked {
  background-color: var(--accent);
}

.toggle-switch:checked::before {
  transform: translateX(30px);
}

.toggle-switch:disabled {
  background-color: var(--bg-control);
  cursor: not-allowed;
}

.toggle-switch:disabled::before {
  background-color: var(--text-faint);
}
</style>
