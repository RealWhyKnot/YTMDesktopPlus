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
  companionServerSavedEnabled,
  companionServerAuthTokens,
  lastFMSessionKey,
  memorySettingsChanged,
  restartDiscordPresence,
  deleteCompanionAuthToken,
  logoutLastFM,
  connectLastFM
} = shell;

const companionServerEnabled = staged.refs["integrations.companionServerEnabled"];
const companionServerCORSWildcardEnabled = staged.refs["integrations.companionServerCORSWildcardEnabled"];
const companionServerLANEnabled = staged.refs["integrations.companionServerLANEnabled"];
const discordPresenceEnabled = staged.refs["integrations.discordPresenceEnabled"];
const discordPresenceHideOnPause = staged.refs["integrations.discordPresenceHideOnPause"];
const lastFMEnabled = staged.refs["integrations.lastFMEnabled"];
const scrobblePercent = staged.refs["lastfm.scrobblePercent"];

function formatLastUsed(lastUsed?: number) {
  if (typeof lastUsed !== "number") return "Unknown";
  return new Date(lastUsed).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
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
      v-model="companionServerLANEnabled"
      type="checkbox"
      indented
      name="Allow other devices on your network"
      description="Lets phones and other devices on your network connect over plain HTTP, which is not encrypted"
      @change="stageChanged"
    />
    <YTMDSetting
      v-if="companionServerEnabled && safeStorageAvailable"
      v-model="companionServerAuthWindowEnabled"
      type="checkbox"
      indented
      name="Enable companion authorization"
      description="Takes effect without saving and turns off after 5 minutes or once an app is approved"
      :disabled="!companionServerSavedEnabled"
      disabled-message="Save your changes to start the companion server first"
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
            <th class="last-used">Last used</th>
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
            <td class="last-used">{{ formatLastUsed(authToken.lastUsed) }}</td>
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
      <p class="discord-failure">Can't connect to Discord. Still trying.</p>
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
          Signed in to Last.fm:
          <span v-if="lastFMSessionKey" style="color: var(--success)">Yes</span>
          <span v-else style="color: var(--danger)">No</span>
        </p>
      </div>
      <button v-if="lastFMSessionKey" @click="logoutLastFM">Log out</button>
      <button v-else @click="connectLastFM">Connect</button>
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
  width: 50%;
  word-wrap: break-word;
}

.authorized-companions-table tr .companion .id {
  color: var(--text-faint);
  font-size: 14px;
}

.authorized-companions-table tr .version,
.authorized-companions-table tr .last-used {
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
