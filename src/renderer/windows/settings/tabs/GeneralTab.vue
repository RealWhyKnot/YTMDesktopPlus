<script setup lang="ts">
import YTMDSetting from "../../../components/YTMDSetting.vue";
import { UpdateChannel } from "~shared/store/schema";
import { useStagedSettings } from "../use-staged-settings";
import { useSettingsShell } from "../context";

const staged = useStagedSettings();
const shell = useSettingsShell();
const stageChanged = staged.stageChanged;
const { isDarwin, isLinux, autoUpdaterDisabled } = shell;

const hideToTrayOnClose = staged.modelBoolean("general.hideToTrayOnClose");
const showNotificationOnSongChange = staged.modelBoolean("general.showNotificationOnSongChange");
const startOnBoot = staged.modelBoolean("general.startOnBoot");
const startMinimized = staged.modelBoolean("general.startMinimized");
const disableHardwareAcceleration = staged.modelBoolean("general.disableHardwareAcceleration");
const debugLogging = staged.modelBoolean("developer.debugLogging");
const autoUpdateEnabled = staged.modelBoolean("updates.autoUpdateEnabled");
const updateChannel = staged.modelSelection("updates.channel");
</script>

<template>
  <div class="general-tab">
    <YTMDSetting v-if="!isDarwin" v-model="hideToTrayOnClose" type="checkbox" name="Hide to tray on close" @change="stageChanged" />
    <YTMDSetting v-model="showNotificationOnSongChange" type="checkbox" name="Show notification on song change" @change="stageChanged" />
    <YTMDSetting v-if="!isLinux" v-model="startOnBoot" type="checkbox" name="Start on boot" @change="stageChanged" />
    <YTMDSetting v-if="!isDarwin" v-model="startMinimized" type="checkbox" name="Start minimized to tray" @change="stageChanged" />
    <YTMDSetting v-model="disableHardwareAcceleration" type="checkbox" restart-required name="Disable hardware acceleration" @change="stageChanged" />
    <YTMDSetting v-model="debugLogging" type="checkbox" name="Debug logging" @change="stageChanged" />
    <YTMDSetting
      v-model="autoUpdateEnabled"
      type="checkbox"
      name="Install updates on launch"
      :disabled="autoUpdaterDisabled"
      disabled-message="The auto updater is unavailable on this platform"
      @change="stageChanged"
    />
    <YTMDSetting
      v-if="!autoUpdaterDisabled"
      v-model="updateChannel"
      :options-map="{ [UpdateChannel.Auto]: 'Match installed build', [UpdateChannel.Stable]: 'Stable', [UpdateChannel.Beta]: 'Beta' }"
      type="select"
      indented
      name="Update channel"
      description="Changing the channel applies the matching update when you save"
      @change="stageChanged"
    />
  </div>
</template>
