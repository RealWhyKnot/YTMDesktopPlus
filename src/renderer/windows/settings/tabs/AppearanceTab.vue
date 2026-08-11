<script setup lang="ts">
import { inject } from "vue";
import YTMDSetting from "../../../components/YTMDSetting.vue";
import { TrayIconStyle } from "~shared/store/schema";
import { STAGED_SETTING_KEYS, StagedSettingKey } from "~shared/settings-staging";
import { stagedSettingsKey } from "../useStagedSettings";
import { settingsShellKey } from "../context";

const staged = inject(stagedSettingsKey);
const shell = inject(settingsShellKey);
const stageChanged = staged.stageChanged;
const { isLinux } = shell;

const store = window.ytmd.store;

const alwaysShowVolumeSlider = staged.refs["appearance.alwaysShowVolumeSlider"];
const customCSSEnabled = staged.refs["appearance.customCSSEnabled"];
const customCSSPath = staged.refs["appearance.customCSSPath"];
const zoom = staged.refs["appearance.zoom"];
const trayIconStyle = staged.refs["appearance.trayIconStyle"];

async function settingChangedFile(event: Event) {
  const target = event.target as HTMLInputElement;

  const setting = target.dataset.setting;
  if (!setting) {
    throw new Error("No setting specified in File Input");
  }

  const value = target.files.length > 0 ? window.ytmd.getTrueFilePath(target.files[0]) : null;
  const stagedKey = setting as StagedSettingKey;
  if (STAGED_SETTING_KEYS.includes(stagedKey)) {
    staged.refs[stagedKey].value = value;
    stageChanged();
  } else {
    store.set(setting, value);
  }

  target.value = null;
}

function removeCustomCSSPath() {
  customCSSPath.value = null;
  stageChanged();
}
</script>

<template>
  <div class="appearance-tab">
    <YTMDSetting v-model="alwaysShowVolumeSlider" type="checkbox" name="Always show volume slider" @change="stageChanged" />
    <YTMDSetting v-model="customCSSEnabled" type="checkbox" name="Custom CSS" @change="stageChanged" />
    <YTMDSetting
      v-if="customCSSEnabled"
      v-model="customCSSPath"
      type="file"
      indented
      bind-setting="appearance.customCSSPath"
      name="Custom CSS file path"
      @file-change="settingChangedFile"
      @clear="removeCustomCSSPath"
    />
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
