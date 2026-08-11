<script setup lang="ts">
import { inject } from "vue";
import YTMDSetting from "../../../components/YTMDSetting.vue";
import { UpdateChannel } from "~shared/store/schema";
import { stagedSettingsKey } from "../useStagedSettings";
import { settingsShellKey } from "../context";

const staged = inject(stagedSettingsKey);
const shell = inject(settingsShellKey);
const stageChanged = staged.stageChanged;
const { isDarwin, autoUpdaterDisabled } = shell;

const hideToTrayOnClose = staged.refs["general.hideToTrayOnClose"];
const showNotificationOnSongChange = staged.refs["general.showNotificationOnSongChange"];
const startOnBoot = staged.refs["general.startOnBoot"];
const disableHardwareAcceleration = staged.refs["general.disableHardwareAcceleration"];
const debugLogging = staged.refs["developer.debugLogging"];
const autoUpdateEnabled = staged.refs["updates.autoUpdateEnabled"];
const updateChannel = staged.refs["updates.channel"];
</script>

<template>
  <div class="general-tab">
    <YTMDSetting v-if="!isDarwin" v-model="hideToTrayOnClose" type="checkbox" name="Hide to tray on close" @change="stageChanged" />
    <YTMDSetting v-model="showNotificationOnSongChange" type="checkbox" name="Show notification on song change" @change="stageChanged" />
    <YTMDSetting v-model="startOnBoot" type="checkbox" name="Start on boot" @change="stageChanged" />
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
