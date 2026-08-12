<script setup lang="ts">
import { inject } from "vue";
import YTMDSetting from "../../../components/YTMDSetting.vue";
import { stagedSettingsKey } from "../useStagedSettings";

const staged = inject(stagedSettingsKey);
const stageChanged = staged.stageChanged;

const continueWhereYouLeftOff = staged.refs["playback.continueWhereYouLeftOff"];
const continueWhereYouLeftOffPaused = staged.refs["playback.continueWhereYouLeftOffPaused"];
const progressInTaskbar = staged.refs["playback.progressInTaskbar"];
const enableSpeakerFill = staged.refs["playback.enableSpeakerFill"];
const ratioVolume = staged.refs["playback.ratioVolume"];
const preventIdlePause = staged.refs["playback.preventIdlePause"];
const adBlockerEnabled = staged.refs["playback.adBlockerEnabled"];
</script>

<template>
  <div class="playback-tab">
    <YTMDSetting v-model="continueWhereYouLeftOff" name="Continue where you left off" type="checkbox" @change="stageChanged" />
    <YTMDSetting
      v-if="continueWhereYouLeftOff"
      v-model="continueWhereYouLeftOffPaused"
      type="checkbox"
      indented
      name="Pause on application launch"
      @change="stageChanged"
    />
    <YTMDSetting v-model="progressInTaskbar" type="checkbox" name="Show track progress on taskbar" @change="stageChanged" />
    <YTMDSetting v-model="enableSpeakerFill" type="checkbox" restart-required name="Enable speaker fill" @change="stageChanged" />
    <YTMDSetting v-model="ratioVolume" type="checkbox" name="Ratio volume" @change="stageChanged" />
    <YTMDSetting
      v-model="preventIdlePause"
      type="checkbox"
      name="Keep playing when idle"
      description="Holds back the pause YouTube Music applies after a long stretch without interaction and dismisses the prompt that follows it"
      @change="stageChanged"
    />
    <YTMDSetting
      v-model="adBlockerEnabled"
      type="checkbox"
      name="Block ads"
      description="Filters every request the YouTube Music session makes, sign-in included, against the EasyList and EasyPrivacy blocklists. The lists are downloaded on first use"
      @change="stageChanged"
    />
  </div>
</template>
