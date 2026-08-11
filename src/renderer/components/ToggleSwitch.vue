<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  modelValue?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits(["update:modelValue", "change"]);

const value = computed({
  get() {
    return props.modelValue;
  },
  set(value) {
    emit("update:modelValue", value);
  }
});
</script>

<template>
  <input v-model="value" type="checkbox" class="toggle-switch" :disabled="disabled" @change="$emit('change', $event)" />
</template>

<style scoped>
.toggle-switch {
  -webkit-appearance: none;
  -moz-appearance: none;
  appearance: none;
  min-width: 62px;
  min-height: 32px;
  width: 62px;
  height: 32px;
  display: inline-block;
  position: relative;
  border-radius: 50px;
  overflow: hidden;
  outline: none;
  border: none;
  cursor: pointer;
  background-color: var(--bg-control);
  transition: background-color ease 0.3s;
}

.toggle-switch:before {
  content: "";
  display: block;
  position: absolute;
  z-index: 2;
  width: 28px;
  height: 28px;
  background: #fff;
  left: 2px;
  top: 2px;
  border-radius: 50%;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  transition: all ease 0.3s;
}

.toggle-switch:checked {
  background-color: var(--accent);
}

.toggle-switch:checked:before {
  left: 32px;
}

.toggle-switch:disabled {
  background-color: var(--bg-control);
  cursor: not-allowed;
}

.toggle-switch:disabled::before {
  background-color: var(--text-faint);
}
</style>
