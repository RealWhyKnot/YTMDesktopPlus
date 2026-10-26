<script setup lang="ts">
import { inject } from "vue";
import KeybindInput from "../../../components/KeybindInput.vue";
import { stagedSettingsKey } from "../useStagedSettings";
import { settingsShellKey } from "../context";

const staged = inject(stagedSettingsKey);
const shell = inject(settingsShellKey);
const stageChanged = staged.stageChanged;

const rows = [
  { key: "shortcuts.playPause", label: "Play/pause", failed: shell.shortcutRegisterFailed.playPause },
  { key: "shortcuts.next", label: "Next", failed: shell.shortcutRegisterFailed.next },
  { key: "shortcuts.previous", label: "Previous", failed: shell.shortcutRegisterFailed.previous },
  { key: "shortcuts.thumbsUp", label: "Thumbs up", failed: shell.shortcutRegisterFailed.thumbsUp },
  { key: "shortcuts.thumbsDown", label: "Thumbs down", failed: shell.shortcutRegisterFailed.thumbsDown },
  { key: "shortcuts.volumeUp", label: "Increase volume", failed: shell.shortcutRegisterFailed.volumeUp },
  { key: "shortcuts.volumeDown", label: "Decrease volume", failed: shell.shortcutRegisterFailed.volumeDown }
] as const;

function duplicateMessage(key: string): string | null {
  const value = staged.refs[key].value;
  if (!value) return null;
  const others = rows.filter(row => row.key !== key && staged.refs[row.key].value === value).map(row => row.label);
  if (others.length === 0) return null;
  const names = others.length === 1 ? others[0] : `${others.slice(0, -1).join(", ")} and ${others[others.length - 1]}`;
  return `Same shortcut as ${names}`;
}
</script>

<template>
  <div class="shortcuts-tab">
    <div v-for="row in rows" :key="row.key" class="shortcut-row">
      <div class="setting">
        <p class="shortcut-title">
          {{ row.label }}<span v-if="row.failed.value" class="material-symbols-outlined register-error" aria-hidden="true">error</span>
        </p>
        <KeybindInput v-model="staged.refs[row.key].value" :label="row.label" @change="stageChanged" />
      </div>
      <p v-if="row.failed.value" class="shortcut-message register-error-text">Couldn't register this shortcut. Another app might be using it.</p>
      <p v-if="duplicateMessage(row.key)" class="shortcut-message duplicate">{{ duplicateMessage(row.key) }}</p>
    </div>
  </div>
</template>

<style scoped>
.shortcut-title {
  display: flex;
  justify-content: center;
  align-items: center;
}

.shortcut-title .register-error {
  margin-left: 4px;
  color: var(--accent);
}

.shortcut-message {
  margin: 0 0 var(--space-sm) 0;
  color: var(--text-muted);
  font-size: 14px;
  overflow-wrap: anywhere;
}

.shortcut-message.register-error-text {
  color: var(--accent);
}
</style>
