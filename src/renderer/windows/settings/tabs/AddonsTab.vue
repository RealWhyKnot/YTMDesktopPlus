<script setup lang="ts">
import { computed } from "vue";
import AddonCard from "../AddonCard.vue";
import { useSettingsShell } from "../context";

const shell = useSettingsShell();
const addons = shell.addons;

const hasExternal = computed(() => addons.value.some((addon) => addon.origin === "external"));

function toggleAddon(id: string, isEnabled: boolean) {
  shell.setAddonEnabled(id, isEnabled);
}
</script>

<template>
  <div class="addons-tab">
    <div class="addons-header">
      <p class="count">{{ addons.length }} addon{{ addons.length === 1 ? "" : "s" }} installed</p>
      <button @click="shell.openAddonsFolder()"><span class="material-symbols-outlined">folder_open</span>Open addons folder</button>
    </div>
    <p v-if="hasExternal" class="external-warning">
      <span class="material-symbols-outlined">warning</span>
      External addons run with the same permissions as the app itself. Only install addons you trust.
    </p>
    <div v-if="addons.length === 0" class="empty-state">
      <span class="material-symbols-outlined">extension_off</span>
      <p>No addons installed</p>
      <p class="hint">Drop an addon folder into the addons directory and restart the app.</p>
    </div>
    <AddonCard v-for="addon in addons" :key="addon.manifest.id" :addon="addon" @toggle="(enabled) => toggleAddon(addon.manifest.id, enabled)" />
  </div>
</template>

<style scoped>
.addons-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-wrap: wrap;
  margin-bottom: var(--space-sm);
}

.external-warning {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  border-left: 3px solid var(--accent);
  background-color: var(--bg-raised);
  border-radius: var(--radius);
  padding: var(--space-sm) var(--space-md);
  margin: 0 0 var(--space-md) 0;
  color: var(--text-muted);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--text-faint);
  padding: var(--space-lg) 0;
}

.empty-state p {
  margin: 0;
}

.addons-header .count {
  margin: 0;
  color: var(--text-muted);
}

.external-warning .material-symbols-outlined {
  color: var(--accent);
}

.empty-state .material-symbols-outlined {
  font-size: calc(48rem / var(--font-size-reference));
  margin-bottom: var(--space-sm);
}

.empty-state .hint {
  margin-top: 4px;
  font-size: calc(14rem / var(--font-size-reference));
}

.addons-header button .material-symbols-outlined {
  margin-right: 4px;
  font-size: calc(18rem / var(--font-size-reference));
}
</style>
