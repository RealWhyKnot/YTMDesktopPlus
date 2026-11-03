<script setup lang="ts">
import YTMDSetting from "../../../components/YTMDSetting.vue";
import { TrayIconStyle } from "~shared/store/schema";
import { useStagedSettings } from "../use-staged-settings";
import { useSettingsShell } from "../context";

const staged = useStagedSettings();
const shell = useSettingsShell();
const stageChanged = staged.stageChanged;
const { isLinux } = shell;

const alwaysShowVolumeSlider = staged.modelBoolean("appearance.alwaysShowVolumeSlider");
const zoom = staged.modelNumber("appearance.zoom");
const trayIconStyle = staged.modelSelection("appearance.trayIconStyle");
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
