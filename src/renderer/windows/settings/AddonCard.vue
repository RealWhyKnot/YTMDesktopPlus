<script setup lang="ts">
import { computed, inject, ref } from "vue";
import ToggleSwitch from "../../components/ToggleSwitch.vue";
import YTMDSetting from "../../components/YTMDSetting.vue";
import type { AddonDescriptor, AddonSettingsField } from "~shared/addons/types";
import { stagedSettingsKey } from "./useStagedSettings";

const props = defineProps<{
  addon: AddonDescriptor;
}>();
const emit = defineEmits<{
  toggle: [enabled: boolean];
}>();

const staged = inject(stagedSettingsKey);
const expanded = ref(false);

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

const hasSettings = computed(
  () => props.addon.state === "active" && props.addon.enabled && props.addon.settingsSections.some(section => section.fields.length > 0)
);

function fieldPath(key: string) {
  return `addons.settings.${props.addon.manifest.id}.${key}`;
}

function numberChanged(key: string) {
  const fieldRef = staged.refs[fieldPath(key)];
  fieldRef.value = Number(fieldRef.value);
  staged.stageChanged();
}

function optionsMapOf(field: AddonSettingsField & { type: "select" }) {
  const map: Record<string, string> = {};
  for (const option of field.options) {
    map[String(option.value)] = option.label;
  }
  return map;
}

function selectValueType(field: AddonSettingsField & { type: "select" }) {
  return typeof field.options[0]?.value === "string" ? "string" : "number";
}

function invokeAction(key: string) {
  window.ytmd.addons?.invokeAction(props.addon.manifest.id, key);
}

const hasHomepage = computed(() => /^https?:\/\//.test(props.addon.manifest.homepage ?? ""));

function openHomepage() {
  window.ytmd.addons?.openHomepage(props.addon.manifest.id);
}

const logCopied = ref(false);
async function copyRecentLog() {
  const lines = (await window.ytmd.addons?.getRecentLog(props.addon.manifest.id)) ?? [];
  await navigator.clipboard.writeText(lines.length > 0 ? lines.join("\n") : "No log lines from this addon yet.");
  logCopied.value = true;
  setTimeout(() => (logCopied.value = false), 2000);
}
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
    <p class="author">
      by {{ addon.manifest.author }}
      <button v-if="hasHomepage" class="homepage" @click="openHomepage"><span class="material-symbols-outlined">open_in_new</span>Homepage</button>
    </p>
    <p class="description">{{ addon.manifest.description }}</p>
    <p v-if="statusText" class="status"><span class="material-symbols-outlined">error</span>{{ statusText }}</p>
    <p v-if="addon.state === 'active' && addon.lastError" class="status runtime">
      <span class="material-symbols-outlined">warning</span>Recent error: {{ addon.lastError }}
    </p>
    <div class="card-actions">
      <button v-if="hasSettings" class="expander" @click="expanded = !expanded">
        <span class="material-symbols-outlined">{{ expanded ? "expand_less" : "expand_more" }}</span
        >{{ expanded ? "Hide settings" : "Settings" }}
      </button>
      <button v-if="addon.state === 'active' || addon.state === 'error'" class="expander" @click="copyRecentLog">
        <span class="material-symbols-outlined">{{ logCopied ? "check" : "content_copy" }}</span
        >{{ logCopied ? "Copied" : "Copy recent log" }}
      </button>
    </div>
    <div v-if="expanded && hasSettings" class="addon-settings">
      <template v-for="(section, sectionIndex) in addon.settingsSections" :key="sectionIndex">
        <p v-if="section.title" class="section-title">{{ section.title }}</p>
        <template v-for="field in section.fields" :key="field.key">
          <YTMDSetting v-if="field.type === 'button'" type="custom" :name="field.label" :description="field.description">
            <button class="action-button" @click="invokeAction(field.key)">{{ field.buttonText }}</button>
          </YTMDSetting>
          <template v-else-if="staged.refs[fieldPath(field.key)]">
            <YTMDSetting
              v-if="field.type === 'toggle'"
              v-model="staged.refs[fieldPath(field.key)].value"
              type="checkbox"
              :name="field.label"
              :description="field.description"
              @change="staged.stageChanged"
            />
            <YTMDSetting
              v-else-if="field.type === 'text'"
              v-model="staged.refs[fieldPath(field.key)].value"
              type="text"
              :name="field.label"
              :description="field.description"
              :placeholder="field.placeholder"
              :maxlength="field.maxlength"
              @change="staged.stageChanged"
            />
            <YTMDSetting
              v-else-if="field.type === 'number'"
              v-model="staged.refs[fieldPath(field.key)].value"
              :type="field.display === 'input' ? 'number' : 'range'"
              :name="field.label"
              :description="field.description"
              :min="field.min"
              :max="field.max"
              :step="field.step"
              @change="numberChanged(field.key)"
            />
            <YTMDSetting
              v-else-if="field.type === 'select'"
              v-model="staged.refs[fieldPath(field.key)].value"
              type="select"
              :name="field.label"
              :description="field.description"
              :options-map="optionsMapOf(field)"
              :value-type="selectValueType(field)"
              @change="staged.stageChanged"
            />
          </template>
        </template>
      </template>
    </div>
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

.author .homepage {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 8px;
  background: none;
  border: none;
  padding: 0;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
}

.author .homepage .material-symbols-outlined {
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

.status.runtime {
  color: var(--text-muted);
}

.action-button {
  background-color: var(--bg-control);
  color: var(--text);
  border: none;
  border-radius: var(--radius);
  padding: 8px 14px;
  cursor: pointer;
}

.action-button:hover {
  background-color: var(--bg-control-hover);
}

.card-actions {
  display: flex;
  gap: var(--space-md);
}

.expander {
  display: flex;
  align-items: center;
  gap: 2px;
  margin: var(--space-sm) 0 0 0;
  background: none;
  border: none;
  padding: 0;
  color: var(--text-muted);
  cursor: pointer;
}

.expander .material-symbols-outlined {
  font-size: 18px;
}

.addon-settings {
  margin-top: var(--space-sm);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border);
}

.section-title {
  margin: var(--space-sm) 0 0 0;
  color: var(--text-faint);
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
