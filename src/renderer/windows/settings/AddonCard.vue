<script setup lang="ts">
import { computed } from "vue";
import ToggleSwitch from "../../components/ToggleSwitch.vue";
import type { AddonDescriptor } from "~shared/addons/types";

const props = defineProps<{
  addon: AddonDescriptor;
}>();
const emit = defineEmits<{
  toggle: [enabled: boolean];
}>();

const statusText = computed(() => {
  switch (props.addon.state) {
    case "error":
      return props.addon.error ?? "Failed to load";
    case "incompatible":
      return props.addon.error ?? "Not compatible with this app version";
    default:
      return null;
  }
});
</script>

<template>
  <div class="addon-card">
    <div class="header">
      <span class="name">{{ addon.manifest.name }}</span>
      <span class="pill version">v{{ addon.manifest.version }}</span>
      <span v-if="addon.origin === 'bundled'" class="pill origin">bundled</span>
      <span v-else class="pill origin external">external</span>
      <span v-if="addon.restartRequired" class="pill restart"><span class="material-symbols-outlined">autorenew</span>Restart required</span>
      <ToggleSwitch class="toggle" :model-value="addon.enabled" @update:model-value="emit('toggle', $event as boolean)" />
    </div>
    <p class="author">by {{ addon.manifest.author }}</p>
    <p class="description">{{ addon.manifest.description }}</p>
    <p v-if="statusText" class="status"><span class="material-symbols-outlined">error</span>{{ statusText }}</p>
    <slot></slot>
  </div>
</template>

<style scoped>
.addon-card {
  background-color: var(--bg-raised);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
}

.header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
}

.header .name {
  font-weight: 600;
}

.pill {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 12px;
}

.pill.version {
  background-color: var(--bg-control);
  color: var(--text-muted);
}

.pill.origin {
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
}

.pill.origin.external {
  border-color: var(--accent);
  color: var(--accent);
}

.pill.restart {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background-color: var(--accent);
}

.pill.restart .material-symbols-outlined {
  font-size: 14px;
}

.toggle {
  margin-left: auto;
}

.author {
  margin: 4px 0 0 0;
  color: var(--text-faint);
  font-size: 14px;
}

.description {
  margin: 8px 0 0 0;
  color: var(--text-muted);
}

.status {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 8px 0 0 0;
  color: var(--accent);
}

.status .material-symbols-outlined {
  font-size: 18px;
}
</style>
