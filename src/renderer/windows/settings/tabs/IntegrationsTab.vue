<script setup lang="ts">
import { inject } from "vue";
import YTMDSetting from "../../../components/YTMDSetting.vue";
import { stagedSettingsKey } from "../useStagedSettings";
import { settingsShellKey } from "../context";

const staged = inject(stagedSettingsKey);
const shell = inject(settingsShellKey);
const stageChanged = staged.stageChanged;
const {
  safeStorageAvailable,
  discordPresenceConnectionFailed,
  companionServerAuthWindowEnabled,
  companionServerAuthTokens,
  lastFMSessionKey,
  memorySettingsChanged,
  restartDiscordPresence,
  deleteCompanionAuthToken,
  logoutLastFM,
  openRoomWindow
} = shell;

const companionServerEnabled = staged.refs["integrations.companionServerEnabled"];
const companionServerCORSWildcardEnabled = staged.refs["integrations.companionServerCORSWildcardEnabled"];
const listenAlongRoomsEnabled = staged.refs["integrations.listenAlongRoomsEnabled"];
const listenAlongDisplayName = staged.refs["integrations.listenAlongDisplayName"];
const listenAlongAudioStreamEnabled = staged.refs["integrations.listenAlongAudioStreamEnabled"];
const listenAlongAutoRoomEnabled = staged.refs["integrations.listenAlongAutoRoomEnabled"];
const discordPresenceEnabled = staged.refs["integrations.discordPresenceEnabled"];
const discordPresenceHideOnPause = staged.refs["integrations.discordPresenceHideOnPause"];
const lastFMEnabled = staged.refs["integrations.lastFMEnabled"];
const scrobblePercent = staged.refs["lastfm.scrobblePercent"];
</script>

<template>
  <div class="integrations-tab">
    <YTMDSetting
      v-model="companionServerEnabled"
      type="checkbox"
      name="Companion server"
      :disabled="!safeStorageAvailable"
      disabled-message="This integration cannot be enabled due to safeStorage being unavailable"
      @change="stageChanged"
    />
    <YTMDSetting
      v-if="companionServerEnabled && safeStorageAvailable"
      v-model="companionServerCORSWildcardEnabled"
      type="checkbox"
      indented
      name="Allow browser communication"
      description="This setting could be dangerous as it allows any website you visit to communicate with the companion server"
      @change="stageChanged"
    />
    <YTMDSetting
      v-if="companionServerEnabled && safeStorageAvailable"
      v-model="companionServerAuthWindowEnabled"
      type="checkbox"
      indented
      name="Enable companion authorization"
      description="Automatically disables after the first successful authorization or 5 minutes has passed"
      @change="memorySettingsChanged"
    />
    <YTMDSetting
      v-if="companionServerEnabled && safeStorageAvailable"
      type="custom"
      flex-column
      indented
      name="Authorized companions"
      description="This is a list of companions that currently have access to the companion server"
      @change="stageChanged"
    >
      <table class="authorized-companions-table">
        <thead>
          <tr>
            <th class="companion">Companion</th>
            <th class="version">Version</th>
            <th class="controls"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="authToken in companionServerAuthTokens" :key="authToken.appId">
            <td class="companion">
              <span class="name">{{ authToken.appName }}</span
              ><br />
              <span class="id">{{ authToken.appId }}</span>
            </td>
            <td class="version">{{ authToken.appVersion }}</td>
            <td class="controls">
              <button @click="deleteCompanionAuthToken(authToken.appId)"><span class="material-symbols-outlined">delete</span></button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="companionServerAuthTokens.length === 0" class="no-authorized-companions">
        <td>No authorized companions</td>
      </div>
    </YTMDSetting>
    <YTMDSetting
      v-model="listenAlongRoomsEnabled"
      type="checkbox"
      name="Listen Along rooms"
      description="When off, the app never connects to ytmdesktopplus.com and the Listen Along button leaves your Discord presence"
      @change="stageChanged"
    />
    <YTMDSetting
      v-if="listenAlongRoomsEnabled"
      v-model="listenAlongDisplayName"
      type="text"
      indented
      maxlength="24"
      placeholder="Not set"
      name="Room display name"
      description="Shown to people in your rooms. You choose it; it is never taken from your account"
      @change="stageChanged"
    />
    <YTMDSetting
      v-if="listenAlongRoomsEnabled"
      v-model="listenAlongAudioStreamEnabled"
      type="checkbox"
      indented
      name="Stream audio to web listeners"
      description="While you host a room, people who open your room link in a browser hear your playback live. Uses some upload bandwidth"
      @change="stageChanged"
    />
    <YTMDSetting
      v-if="listenAlongRoomsEnabled"
      v-model="listenAlongAutoRoomEnabled"
      type="checkbox"
      indented
      name="Open a room automatically with Discord presence"
      description="While your presence is on, a room stays open so anyone who sees your profile can listen along, with your audio if web streaming is on. Turn off to only share rooms you start yourself"
      @change="stageChanged"
    />
    <div v-if="listenAlongRoomsEnabled" class="setting indented">
      <p>Open the Listen Along window</p>
      <button @click="openRoomWindow">Open</button>
    </div>
    <YTMDSetting v-model="discordPresenceEnabled" type="checkbox" name="Discord rich presence" @change="stageChanged" />
    <YTMDSetting
      v-if="discordPresenceEnabled"
      v-model="discordPresenceHideOnPause"
      type="checkbox"
      indented
      name="Hide presence while paused"
      description="Clears your Discord activity as soon as playback pauses instead of showing a paused badge"
      @change="stageChanged"
    />
    <div v-if="discordPresenceEnabled && discordPresenceConnectionFailed" class="setting indented">
      <p class="discord-failure">Discord connection could not be established after 30 attempts</p>
      <button @click="restartDiscordPresence">Retry</button>
    </div>
    <YTMDSetting
      v-model="lastFMEnabled"
      type="checkbox"
      name="Last.fm scrobbling"
      :disabled="!safeStorageAvailable"
      disabled-message="This integration cannot be enabled due to safeStorage being unavailable"
      @change="stageChanged"
    />
    <div v-if="lastFMEnabled" class="setting indented">
      <div class="name-with-description">
        <p class="description">
          User is Authenticated:
          <span v-if="lastFMSessionKey" style="color: var(--success)">Yes</span>
          <span v-else style="color: #ff1100">No</span>
        </p>
      </div>
      <button v-if="lastFMSessionKey" @click="logoutLastFM">Logout</button>
    </div>
    <YTMDSetting
      v-if="lastFMEnabled"
      v-model="scrobblePercent"
      class="settings indented"
      type="range"
      name="Scrobble percent"
      description="Determines when a song is scrobbled"
      min="50"
      max="95"
      step="5"
      @change="stageChanged"
    />
  </div>
</template>

<style scoped>
.authorized-companions-table {
  width: 100%;
  table-layout: fixed;
}

.authorized-companions-table tr .companion {
  width: 70%;
  word-wrap: break-word;
}

.authorized-companions-table tr .companion .id {
  color: var(--text-faint);
  font-size: 14px;
}

.authorized-companions-table tbody tr .version {
  word-wrap: break-word;
}

.authorized-companions-table tr th,
.authorized-companions-table tr td {
  padding: 4px;
}

.authorized-companions-table th {
  text-align: left;
}

.authorized-companions-table thead tr th {
  border-bottom: 1px solid var(--border);
}
.authorized-companions-table thead tr .controls {
  width: 48px;
}

.authorized-companions-table tbody button {
  border-radius: 4px;
  padding: 4px;
  display: flex;
  align-items: center;
  background-color: var(--bg-control);
  cursor: pointer;
  border: none;
}

.no-authorized-companions {
  color: var(--text-muted);
  padding: 4px;
}

.discord-failure {
  margin: 0;
  color: var(--text-faint);
}
</style>
