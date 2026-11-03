<script setup lang="ts">
import YTMDSetting from "../../../components/YTMDSetting.vue";
import { useStagedSettings } from "../use-staged-settings";

const staged = useStagedSettings();
const stageChanged = staged.stageChanged;

const continueWhereYouLeftOff = staged.modelBoolean("playback.continueWhereYouLeftOff");
const continueWhereYouLeftOffPaused = staged.modelBoolean("playback.continueWhereYouLeftOffPaused");
const progressInTaskbar = staged.modelBoolean("playback.progressInTaskbar");
const enableSpeakerFill = staged.modelBoolean("playback.enableSpeakerFill");
const ratioVolume = staged.modelBoolean("playback.ratioVolume");
const preventIdlePause = staged.modelBoolean("playback.preventIdlePause");
const adBlockerEnabled = staged.modelBoolean("playback.adBlockerEnabled");
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
      description="Removes ads from the player's own track data before it can schedule them, and mutes and runs through anything that still gets played. Also filters the session's requests against the EasyList and EasyPrivacy blocklists, downloaded on first use"
      @change="stageChanged"
    />
  </div>
</template>
