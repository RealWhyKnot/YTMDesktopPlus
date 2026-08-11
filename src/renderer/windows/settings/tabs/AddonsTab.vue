<script setup lang="ts">
import { computed, inject } from "vue";
import AddonCard from "../AddonCard.vue";
import { settingsShellKey } from "../context";

const shell = inject(settingsShellKey);
const addons = shell.addons;

const hasExternal = computed(() => addons.value.some(addon => addon.origin === "external"));

function toggleAddon(id: string, enabled: boolean) {
  shell.setAddonEnabled(id, enabled);
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
    <AddonCard v-for="addon in addons" :key="addon.manifest.id" :addon="addon" @toggle="enabled => toggleAddon(addon.manifest.id, enabled)" />
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

.addons-header .count {
  margin: 0;
  color: var(--text-muted);
}

.addons-header button .material-symbols-outlined {
  margin-right: 4px;
  font-size: 18px;
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

.external-warning .material-symbols-outlined {
  color: var(--accent);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: var(--text-faint);
  padding: var(--space-lg) 0;
}

.empty-state .material-symbols-outlined {
  font-size: 48px;
  margin-bottom: var(--space-sm);
}

.empty-state p {
  margin: 0;
}

.empty-state .hint {
  margin-top: 4px;
  font-size: 14px;
}
</style>
