<script setup lang="ts">
import { inject } from "vue";
import YTMDSetting from "../../../components/YTMDSetting.vue";
import { TrayIconStyle } from "~shared/store/schema";
import { stagedSettingsKey } from "../useStagedSettings";
import { settingsShellKey } from "../context";

const staged = inject(stagedSettingsKey);
const shell = inject(settingsShellKey);
const stageChanged = staged.stageChanged;
const { isLinux } = shell;

const alwaysShowVolumeSlider = staged.refs["appearance.alwaysShowVolumeSlider"];
const zoom = staged.refs["appearance.zoom"];
const trayIconStyle = staged.refs["appearance.trayIconStyle"];
</script>

<template>
  <div class="appearance-tab">
    <YTMDSetting v-model="alwaysShowVolumeSlider" type="checkbox" name="Always show volume slider" @change="stageChanged" />
    <YTMDSetting v-model="zoom" type="range" max="300" min="30" step="10" name="Zoom" @change="stageChanged" />
    <YTMDSetting
      v-if="isLinux"
      v-model="trayIconStyle"
      :options-map="{ [TrayIconStyle.Auto]: 'Auto', [TrayIconStyle.White]: 'White', [TrayIconStyle.Black]: 'Black' }"
      type="select"
      name="Tray icon style"
      @change="stageChanged"
    />
  </div>
</template>
