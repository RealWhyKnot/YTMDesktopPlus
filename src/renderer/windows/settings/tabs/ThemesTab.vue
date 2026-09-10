<script setup lang="ts">
import { computed, inject } from "vue";
import { settingsShellKey } from "../context";

const shell = inject(settingsShellKey);
const themes = shell.themes;

const active = computed(() => themes.value.find(theme => theme.active) ?? null);
const usable = computed(() => themes.value.filter(theme => theme.state === "ok"));
const broken = computed(() => themes.value.filter(theme => theme.state !== "ok"));
</script>

<template>
  <div class="themes-tab">
    <div class="themes-header">
      <p class="count">{{ usable.length }} theme{{ usable.length === 1 ? "" : "s" }} available</p>
      <div class="header-actions">
        <button @click="shell.installThemeFromFile()"><span class="material-symbols-outlined">archive</span>Install from file</button>
        <button @click="shell.openThemesFolder()"><span class="material-symbols-outlined">folder_open</span>Open themes folder</button>
      </div>
    </div>

    <p v-if="shell.themeError.value" class="theme-error">
      <span class="material-symbols-outlined">error</span>
      {{ shell.themeError.value }}
    </p>

    <div class="grid">
      <button class="theme-card none" :class="{ selected: active === null }" @click="shell.setActiveTheme(null)">
        <div class="swatches stock">
          <span class="material-symbols-outlined">format_color_reset</span>
        </div>
        <p class="name">None</p>
        <p class="author">The stock look</p>
      </button>

      <button
        v-for="theme in usable"
        :key="theme.manifest.id"
        class="theme-card"
        :class="{ selected: theme.active }"
        @click="shell.setActiveTheme(theme.manifest.id)"
      >
        <img v-if="theme.previewDataUrl" class="preview" :src="theme.previewDataUrl" alt="" />
        <div v-else class="swatches">
          <span v-for="(color, index) in theme.swatch" :key="index" :style="{ backgroundColor: color }"></span>
        </div>
        <p class="name">
          {{ theme.manifest.name }}
          <span v-if="theme.watching" class="material-symbols-outlined watching" title="Live reloading while you edit">visibility</span>
        </p>
        <p class="author">{{ theme.manifest.author }}</p>
        <p class="description">{{ theme.manifest.description }}</p>
        <p v-for="warning in theme.warnings" :key="warning" class="warning">{{ warning }}</p>
      </button>
    </div>

    <div v-if="active" class="active-actions">
      <p class="active-name">{{ active.manifest.name }}</p>
      <div class="header-actions">
        <button @click="shell.duplicateTheme(active.manifest.id)"><span class="material-symbols-outlined">content_copy</span>Duplicate to edit</button>
        <button @click="shell.exportTheme(active.manifest.id)"><span class="material-symbols-outlined">ios_share</span>Export as zip</button>
      </div>
    </div>

    <div v-if="broken.length > 0" class="broken">
      <p class="broken-title">Not loaded</p>
      <p v-for="theme in broken" :key="theme.manifest.id" class="broken-row">
        <span class="material-symbols-outlined">block</span>
        <strong>{{ theme.manifest.name }}</strong>
        {{ theme.error }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.themes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-wrap: wrap;
  margin-bottom: var(--space-sm);
}

.themes-header .count {
  margin: 0;
  color: var(--text-muted);
}

.header-actions {
  display: flex;
  gap: var(--space-sm);
}

.header-actions button .material-symbols-outlined,
.themes-header button .material-symbols-outlined {
  margin-right: 4px;
  font-size: 18px;
}

.theme-error {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  border-left: 3px solid var(--danger);
  background-color: var(--bg-raised);
  border-radius: var(--radius);
  padding: var(--space-sm) var(--space-md);
  margin: 0 0 var(--space-md) 0;
  color: var(--text-muted);
}

.theme-error .material-symbols-outlined {
  color: var(--danger);
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--space-md);
}

.theme-card {
  display: block;
  text-align: left;
  background-color: var(--bg-raised);
  border: 2px solid var(--border);
  border-radius: var(--radius-lg);
  padding: var(--space-sm);
  cursor: pointer;
  color: var(--text);
  font-family: inherit;
}

.theme-card:hover {
  border-color: var(--border-strong);
}

.theme-card.selected {
  border-color: var(--accent);
}

.preview,
.swatches {
  display: flex;
  width: 100%;
  height: 64px;
  border-radius: var(--radius);
  overflow: hidden;
  object-fit: cover;
  margin-bottom: var(--space-sm);
}

.swatches span {
  flex: 1;
}

.swatches.stock {
  align-items: center;
  justify-content: center;
  background-color: var(--bg-control);
  color: var(--text-faint);
}

.theme-card .name {
  margin: 0;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 4px;
}

.watching {
  font-size: 16px;
  color: var(--success);
}

.theme-card .author {
  margin: 0;
  color: var(--text-faint);
  font-size: 12px;
}

.theme-card .description {
  margin: var(--space-xs) 0 0 0;
  color: var(--text-muted);
  font-size: 13px;
}

.theme-card .warning {
  margin: var(--space-xs) 0 0 0;
  color: var(--text-faint);
  font-size: 12px;
}

.active-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  flex-wrap: wrap;
  margin-top: var(--space-md);
  padding-top: var(--space-md);
  border-top: 1px solid var(--border);
}

.active-actions .active-name {
  margin: 0;
  color: var(--text-muted);
}

.broken {
  margin-top: var(--space-lg);
}

.broken-title {
  margin: 0 0 var(--space-sm) 0;
  color: var(--text-faint);
}

.broken-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin: 0 0 var(--space-xs) 0;
  color: var(--text-muted);
  font-size: 13px;
}

.broken-row .material-symbols-outlined {
  font-size: 18px;
  color: var(--danger);
}
</style>
