<script setup lang="ts">
import { inject } from "vue";
import KeybindInput from "../../../components/KeybindInput.vue";
import { stagedSettingsKey } from "../useStagedSettings";
import { settingsShellKey } from "../context";

const staged = inject(stagedSettingsKey);
const shell = inject(settingsShellKey);
const stageChanged = staged.stageChanged;

const rows = [
  { key: "shortcuts.playPause", label: "Play/Pause", failed: shell.shortcutRegisterFailed.playPause },
  { key: "shortcuts.next", label: "Next", failed: shell.shortcutRegisterFailed.next },
  { key: "shortcuts.previous", label: "Previous", failed: shell.shortcutRegisterFailed.previous },
  { key: "shortcuts.thumbsUp", label: "Thumbs Up", failed: shell.shortcutRegisterFailed.thumbsUp },
  { key: "shortcuts.thumbsDown", label: "Thumbs Down", failed: shell.shortcutRegisterFailed.thumbsDown },
  { key: "shortcuts.volumeUp", label: "Increase Volume", failed: shell.shortcutRegisterFailed.volumeUp },
  { key: "shortcuts.volumeDown", label: "Decrease Volume", failed: shell.shortcutRegisterFailed.volumeDown }
] as const;
</script>

<template>
  <div class="shortcuts-tab">
    <div v-for="row in rows" :key="row.key" class="setting">
      <p class="shortcut-title">
        {{ row.label
        }}<span
          v-if="row.failed.value"
          class="material-symbols-outlined register-error"
          title="Failed to register keybind. Does another application have this keybind?"
          >error</span
        >
      </p>
      <KeybindInput v-model="staged.refs[row.key].value" @change="stageChanged" />
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
</style>
