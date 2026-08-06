<script setup lang="ts">
import { computed, ref, type Ref } from "vue";
import KeybindInput from "../../components/KeybindInput.vue";
import YTMDSetting from "../../components/YTMDSetting.vue";
import { StoreSchema, TrayIconStyle, UpdateChannel } from "~shared/store/schema";
import {
  RESTART_REQUIRED_KEYS,
  STAGED_SETTING_KEYS,
  SettingsSnapshot,
  StagedSettingKey,
  diffSnapshots,
  mergeExternalState,
  normalizeSettingValue,
  snapshotFromState
} from "~shared/settings-staging";
import { AuthToken } from "~shared/integrations/companion-server/types";
import logo from "~assets/icons/ytmd.png";

declare const YTMD_GIT_COMMIT_HASH: string;
declare const YTMD_GIT_BRANCH: string;

const ytmdVersion = await window.ytmd.getAppVersion();
const ytmdCommitHash = YTMD_GIT_COMMIT_HASH.substring(0, 7);
const ytmdBranch = YTMD_GIT_BRANCH;

const isDarwin = window.ytmd.isDarwin;
const isLinux = window.ytmd.isLinux;

const currentTab = ref(1);
const checkingForUpdate = ref(false);
const updateAvailable = ref(await window.ytmd.isAppUpdateAvailable());
const updateNotAvailable = ref(false);
const updateDownloaded = ref(await window.ytmd.isAppUpdateDownloaded());

const store = window.ytmd.store;
const memoryStore = window.ytmd.memoryStore;
const safeStorage = window.ytmd.safeStorage;

const safeStorageAvailable = ref<boolean>(await memoryStore.get("safeStorageAvailable"));

const general: StoreSchema["general"] = await store.get("general");
const developer: StoreSchema["developer"] = await store.get("developer");
const appearance: StoreSchema["appearance"] = await store.get("appearance");
const playback: StoreSchema["playback"] = await store.get("playback");
const integrations: StoreSchema["integrations"] = await store.get("integrations");
const shortcuts: StoreSchema["shortcuts"] = await store.get("shortcuts");
const lastFM: StoreSchema["lastfm"] = await store.get("lastfm");
const updates: StoreSchema["updates"] = await store.get("updates");

// Draft values for every staged key. Nothing here reaches the store until an
// explicit save writes the dirty keys in one batch.
const stagedRefs: Record<StagedSettingKey, Ref<unknown>> = {
  "general.hideToTrayOnClose": ref<unknown>(general.hideToTrayOnClose),
  "general.showNotificationOnSongChange": ref<unknown>(general.showNotificationOnSongChange),
  "general.startOnBoot": ref<unknown>(general.startOnBoot),
  "general.startMinimized": ref<unknown>(general.startMinimized),
  "general.disableHardwareAcceleration": ref<unknown>(general.disableHardwareAcceleration),
  "developer.debugLogging": ref<unknown>(developer.debugLogging),
  "appearance.alwaysShowVolumeSlider": ref<unknown>(appearance.alwaysShowVolumeSlider),
  "appearance.customCSSEnabled": ref<unknown>(appearance.customCSSEnabled),
  "appearance.customCSSPath": ref<unknown>(appearance.customCSSPath),
  "appearance.zoom": ref<unknown>(appearance.zoom),
  "appearance.trayIconStyle": ref<unknown>(appearance.trayIconStyle),
  "playback.continueWhereYouLeftOff": ref<unknown>(playback.continueWhereYouLeftOff),
  "playback.continueWhereYouLeftOffPaused": ref<unknown>(playback.continueWhereYouLeftOffPaused),
  "playback.progressInTaskbar": ref<unknown>(playback.progressInTaskbar),
  "playback.enableSpeakerFill": ref<unknown>(playback.enableSpeakerFill),
  "playback.ratioVolume": ref<unknown>(playback.ratioVolume),
  "playback.loudnessNormalization": ref<unknown>(playback.loudnessNormalization),
  "playback.adBlockerEnabled": ref<unknown>(playback.adBlockerEnabled),
  "playback.preventIdlePause": ref<unknown>(playback.preventIdlePause),
  "integrations.companionServerEnabled": ref<unknown>(integrations.companionServerEnabled),
  "integrations.companionServerCORSWildcardEnabled": ref<unknown>(integrations.companionServerCORSWildcardEnabled),
  "integrations.discordPresenceEnabled": ref<unknown>(integrations.discordPresenceEnabled),
  "integrations.lastFMEnabled": ref<unknown>(integrations.lastFMEnabled),
  "integrations.listenAlongRoomsEnabled": ref<unknown>(integrations.listenAlongRoomsEnabled),
  "integrations.listenAlongDisplayName": ref<unknown>(integrations.listenAlongDisplayName),
  "integrations.listenAlongAudioStreamEnabled": ref<unknown>(integrations.listenAlongAudioStreamEnabled),
  "integrations.listenAlongAutoRoomEnabled": ref<unknown>(integrations.listenAlongAutoRoomEnabled),
  "lastfm.scrobblePercent": ref<unknown>(lastFM.scrobblePercent),
  "shortcuts.playPause": ref<unknown>(shortcuts.playPause),
  "shortcuts.next": ref<unknown>(shortcuts.next),
  "shortcuts.previous": ref<unknown>(shortcuts.previous),
  "shortcuts.thumbsUp": ref<unknown>(shortcuts.thumbsUp),
  "shortcuts.thumbsDown": ref<unknown>(shortcuts.thumbsDown),
  "shortcuts.volumeUp": ref<unknown>(shortcuts.volumeUp),
  "shortcuts.volumeDown": ref<unknown>(shortcuts.volumeDown),
  "updates.autoUpdateEnabled": ref<unknown>(updates.autoUpdateEnabled),
  "updates.channel": ref<unknown>(updates.channel)
};

const hideToTrayOnClose = stagedRefs["general.hideToTrayOnClose"];
const showNotificationOnSongChange = stagedRefs["general.showNotificationOnSongChange"];
const startOnBoot = stagedRefs["general.startOnBoot"];
const disableHardwareAcceleration = stagedRefs["general.disableHardwareAcceleration"];
const debugLogging = stagedRefs["developer.debugLogging"];
const alwaysShowVolumeSlider = stagedRefs["appearance.alwaysShowVolumeSlider"];
const customCSSEnabled = stagedRefs["appearance.customCSSEnabled"];
const customCSSPath = stagedRefs["appearance.customCSSPath"];
const zoom = stagedRefs["appearance.zoom"];
const trayIconStyle = stagedRefs["appearance.trayIconStyle"];
const continueWhereYouLeftOff = stagedRefs["playback.continueWhereYouLeftOff"];
const continueWhereYouLeftOffPaused = stagedRefs["playback.continueWhereYouLeftOffPaused"];
const progressInTaskbar = stagedRefs["playback.progressInTaskbar"];
const enableSpeakerFill = stagedRefs["playback.enableSpeakerFill"];
const ratioVolume = stagedRefs["playback.ratioVolume"];
const loudnessNormalization = stagedRefs["playback.loudnessNormalization"];
const adBlockerEnabled = stagedRefs["playback.adBlockerEnabled"];
const preventIdlePause = stagedRefs["playback.preventIdlePause"];
const companionServerEnabled = stagedRefs["integrations.companionServerEnabled"];
const companionServerCORSWildcardEnabled = stagedRefs["integrations.companionServerCORSWildcardEnabled"];
const discordPresenceEnabled = stagedRefs["integrations.discordPresenceEnabled"];
const lastFMEnabled = stagedRefs["integrations.lastFMEnabled"];
const listenAlongRoomsEnabled = stagedRefs["integrations.listenAlongRoomsEnabled"];
const listenAlongDisplayName = stagedRefs["integrations.listenAlongDisplayName"];
const listenAlongAudioStreamEnabled = stagedRefs["integrations.listenAlongAudioStreamEnabled"];
const listenAlongAutoRoomEnabled = stagedRefs["integrations.listenAlongAutoRoomEnabled"];
const scrobblePercent = stagedRefs["lastfm.scrobblePercent"];
const shortcutPlayPause = stagedRefs["shortcuts.playPause"];
const shortcutNext = stagedRefs["shortcuts.next"];
const shortcutPrevious = stagedRefs["shortcuts.previous"];
const shortcutThumbsUp = stagedRefs["shortcuts.thumbsUp"];
const shortcutThumbsDown = stagedRefs["shortcuts.thumbsDown"];
const shortcutVolumeUp = stagedRefs["shortcuts.volumeUp"];
const shortcutVolumeDown = stagedRefs["shortcuts.volumeDown"];
const autoUpdateEnabled = stagedRefs["updates.autoUpdateEnabled"];
const updateChannel = stagedRefs["updates.channel"];

const companionServerAuthTokens = ref<AuthToken[]>(
  safeStorageAvailable.value ? (JSON.parse(await safeStorage.decryptString(integrations.companionServerAuthTokens)) ?? []) : []
);
const lastFMSessionKey = ref<string>(lastFM.sessionKey);

let pristine: SettingsSnapshot = snapshotFromState({ general, developer, appearance, playback, integrations, shortcuts, lastfm: lastFM });

// Restart is needed when a restart-required key's saved value differs from the
// value this window opened with, matching how long the banner used to live.
const launchRestartValues: Partial<SettingsSnapshot> = {};
for (const key of RESTART_REQUIRED_KEYS) {
  launchRestartValues[key] = pristine[key];
}

const dirtyKeys = ref<StagedSettingKey[]>([]);
const hasUnsavedChanges = computed(() => dirtyKeys.value.length > 0);
const restartNeeded = ref(false);
const showCloseConfirm = ref(false);
let allowClose = false;

function draftSnapshot(): SettingsSnapshot {
  const draft = {} as SettingsSnapshot;
  for (const key of STAGED_SETTING_KEYS) {
    draft[key] = normalizeSettingValue(key, stagedRefs[key].value);
  }
  return draft;
}

function stageChanged() {
  dirtyKeys.value = diffSnapshots(pristine, draftSnapshot());
}

function updateRestartNeeded() {
  restartNeeded.value = [...RESTART_REQUIRED_KEYS].some(key => !Object.is(pristine[key], launchRestartValues[key]));
}

function saveChanges() {
  const draft = draftSnapshot();
  const changed = diffSnapshots(pristine, draft);
  if (changed.length > 0) {
    store.setMany(changed.map(key => [key, draft[key]] as [string, unknown]));
  }
  pristine = { ...draft };
  dirtyKeys.value = [];
  updateRestartNeeded();
}

function resetChanges() {
  for (const key of STAGED_SETTING_KEYS) {
    stagedRefs[key].value = pristine[key];
  }
  dirtyKeys.value = [];
}

store.onDidAnyChange(async newState => {
  const merged = mergeExternalState(pristine, draftSnapshot(), newState);
  pristine = merged.pristine;
  for (const key of merged.followedKeys) {
    stagedRefs[key].value = pristine[key];
  }
  dirtyKeys.value = diffSnapshots(pristine, draftSnapshot());
  updateRestartNeeded();

  companionServerAuthTokens.value = safeStorageAvailable.value
    ? (JSON.parse(await safeStorage.decryptString(newState.integrations.companionServerAuthTokens)) ?? [])
    : [];
  lastFMSessionKey.value = newState.lastfm.sessionKey;
});

const discordPresenceConnectionFailed = ref<boolean>(await memoryStore.get("discordPresenceConnectionFailed"));

const shortcutsPlayPauseRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsPlayPauseRegisterFailed"));
const shortcutsNextRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsNextRegisterFailed"));
const shortcutsPreviousRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsPreviousRegisterFailed"));
const shortcutsThumbsUpRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsThumbsUpRegisterFailed"));
const shortcutsThumbsDownRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsThumbsDownRegisterFailed"));
const shortcutsVolumeUpRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsVolumeUpRegisterFailed"));
const shortcutsVolumeDownRegisterFailed = ref<boolean>(await memoryStore.get("shortcutsVolumeDownRegisterFailed"));

const companionServerAuthWindowEnabled = ref<boolean>(await memoryStore.get("companionServerAuthWindowEnabled"));

const autoUpdaterDisabled = ref<boolean>(await memoryStore.get("autoUpdaterDisabled"));

memoryStore.onStateChanged(newState => {
  discordPresenceConnectionFailed.value = newState.discordPresenceConnectionFailed;

  shortcutsPlayPauseRegisterFailed.value = newState.shortcutsPlayPauseRegisterFailed;
  shortcutsNextRegisterFailed.value = newState.shortcutsNextRegisterFailed;
  shortcutsPreviousRegisterFailed.value = newState.shortcutsPreviousRegisterFailed;
  shortcutsThumbsUpRegisterFailed.value = newState.shortcutsThumbsUpRegisterFailed;
  shortcutsThumbsDownRegisterFailed.value = newState.shortcutsThumbsDownRegisterFailed;
  shortcutsVolumeUpRegisterFailed.value = newState.shortcutsVolumeUpRegisterFailed;
  shortcutsVolumeDownRegisterFailed.value = newState.shortcutsVolumeDownRegisterFailed;

  companionServerAuthWindowEnabled.value = newState.companionServerAuthWindowEnabled;

  safeStorageAvailable.value = newState.safeStorageAvailable;

  autoUpdaterDisabled.value = newState.autoUpdaterDisabled;
});

async function memorySettingsChanged() {
  memoryStore.set("companionServerAuthWindowEnabled", companionServerAuthWindowEnabled.value);
}

async function settingChangedFile(event: Event) {
  const target = event.target as HTMLInputElement;

  const setting = target.dataset.setting;
  if (!setting) {
    throw new Error("No setting specified in File Input");
  }

  const value = target.files.length > 0 ? window.ytmd.getTrueFilePath(target.files[0]) : null;
  const stagedKey = setting as StagedSettingKey;
  if (STAGED_SETTING_KEYS.includes(stagedKey)) {
    stagedRefs[stagedKey].value = value;
    stageChanged();
  } else {
    store.set(setting, value);
  }

  target.value = null;
}

async function restartDiscordPresence() {
  store.set("integrations.discordPresenceEnabled", false);
  store.set("integrations.discordPresenceEnabled", true);
}

async function deleteCompanionAuthToken(appId: string) {
  const index = companionServerAuthTokens.value.findIndex(token => token.appId === appId);
  if (index > -1) {
    companionServerAuthTokens.value.splice(index, 1);
  }

  if (safeStorageAvailable.value)
    store.set("integrations.companionServerAuthTokens", await safeStorage.encryptString(JSON.stringify(companionServerAuthTokens.value)));
}

function removeCustomCSSPath() {
  customCSSPath.value = null;
  stageChanged();
}

function changeTab(newTab: number) {
  currentTab.value = newTab;
}

function restartApplication() {
  window.ytmd.restartApplication();
}

function openRoomWindow() {
  window.ytmd.openRoomWindow();
}

function restartApplicationForUpdate() {
  window.ytmd.restartApplicationForUpdate();
}

function checkForUpdates() {
  window.ytmd.checkForUpdates();
  checkingForUpdate.value = true;
}

async function logoutLastFM() {
  store.set("lastfm.sessionKey", null);
  store.set("integrations.lastFMEnabled", false);
  pristine = { ...pristine, "integrations.lastFMEnabled": false };
  lastFMEnabled.value = false;
  lastFMSessionKey.value = null;
  dirtyKeys.value = diffSnapshots(pristine, draftSnapshot());
}

window.onbeforeunload = (event: BeforeUnloadEvent) => {
  if (hasUnsavedChanges.value && !allowClose) {
    event.returnValue = false;
    showCloseConfirm.value = true;
  }
};

function keepEditing() {
  showCloseConfirm.value = false;
}

function discardAndClose() {
  allowClose = true;
  window.ytmd.closeWindow();
}

function saveAndClose() {
  saveChanges();
  allowClose = true;
  window.ytmd.closeWindow();
}

window.ytmd.handleCheckingForUpdate(() => {
  checkingForUpdate.value = true;
});

window.ytmd.handleUpdateAvailable(() => {
  checkingForUpdate.value = false;
  updateAvailable.value = true;
  updateNotAvailable.value = false;
});

window.ytmd.handleUpdateNotAvailable(() => {
  checkingForUpdate.value = false;
  updateNotAvailable.value = true;
  updateAvailable.value = false;
});

window.ytmd.handleUpdateDownloaded(() => {
  checkingForUpdate.value = false;
  updateNotAvailable.value = false;
  updateAvailable.value = false;
  updateDownloaded.value = true;
});
</script>

<template>
  <div class="settings-container">
    <div class="content-container">
      <ul class="sidebar">
        <li :class="{ active: currentTab === 1 }" @click="changeTab(1)"><span class="material-symbols-outlined">settings_applications</span>General</li>
        <li :class="{ active: currentTab === 2 }" @click="changeTab(2)"><span class="material-symbols-outlined">brush</span>Appearance</li>
        <li :class="{ active: currentTab === 3 }" @click="changeTab(3)"><span class="material-symbols-outlined">music_note</span>Playback</li>
        <li :class="{ active: currentTab === 4 }" @click="changeTab(4)"><span class="material-symbols-outlined">wifi_tethering</span>Integrations</li>
        <li :class="{ active: currentTab === 5 }" @click="changeTab(5)"><span class="material-symbols-outlined">keyboard</span>Shortcuts</li>
        <span class="push"></span>
        <li :class="{ active: currentTab === 99 }" @click="changeTab(99)"><span class="material-symbols-outlined">info</span>About</li>
      </ul>
      <div class="content">
        <div v-if="hasUnsavedChanges" class="save-bar">
          <p class="message"><span class="material-symbols-outlined">edit</span> You have unsaved changes</p>
          <div class="actions">
            <button class="reset-button" @click="resetChanges">Reset</button>
            <button class="save-button" @click="saveChanges">Save Changes</button>
          </div>
        </div>
        <div v-else-if="restartNeeded" class="restart-banner">
          <p class="message"><span class="material-symbols-outlined">autorenew</span> Restart app to apply changes</p>
          <button class="restart-button" @click="restartApplication">Restart</button>
        </div>
        <div v-if="currentTab === 1" class="general-tab">
          <YTMDSetting v-if="!isDarwin" v-model="hideToTrayOnClose" type="checkbox" name="Hide to tray on close" @change="stageChanged" />
          <YTMDSetting v-model="showNotificationOnSongChange" type="checkbox" name="Show notification on song change" @change="stageChanged" />
          <YTMDSetting v-model="startOnBoot" type="checkbox" name="Start on boot" @change="stageChanged" />
          <!--<div class="setting">
            <p>Start minimized</p>
            <input v-model="startMinimized" @change="stageChanged" class="toggle" type="checkbox" />
          </div>-->
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

        <div v-if="currentTab === 2" class="appearance-tab">
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

        <div v-if="currentTab === 3" class="playback-tab">
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
            v-model="loudnessNormalization"
            type="checkbox"
            name="Loudness normalization"
            description="Levels tracks against each other using YouTube's measured loudness. Loud tracks come down; quiet tracks are never boosted"
            @change="stageChanged"
          />
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

        <div v-if="currentTab === 4" class="integrations-tab">
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
                <span v-if="lastFMSessionKey" style="color: #4caf50">Yes</span>
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

        <div v-if="currentTab === 5" class="shortcuts-tab">
          <div class="setting">
            <p class="shortcut-title">
              Play/Pause<span
                v-if="shortcutsPlayPauseRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutPlayPause" @change="stageChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Next<span
                v-if="shortcutsNextRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutNext" @change="stageChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Previous<span
                v-if="shortcutsPreviousRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutPrevious" @change="stageChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Thumbs Up<span
                v-if="shortcutsThumbsUpRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutThumbsUp" @change="stageChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Thumbs Down<span
                v-if="shortcutsThumbsDownRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutThumbsDown" @change="stageChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Increase Volume<span
                v-if="shortcutsVolumeUpRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutVolumeUp" @change="stageChanged" />
          </div>
          <div class="setting">
            <p class="shortcut-title">
              Decrease Volume<span
                v-if="shortcutsVolumeDownRegisterFailed"
                class="material-symbols-outlined register-error"
                title="Failed to register keybind. Does another application have this keybind?"
                >error</span
              >
            </p>
            <KeybindInput v-model="shortcutVolumeDown" @change="stageChanged" />
          </div>
        </div>

        <div v-if="currentTab === 99" class="about-tab">
          <img class="icon" :src="logo" />
          <h2 class="app-name">YTMDesktop+</h2>
          <p class="made-by">Made by YTMDesktop Team</p>
          <template v-if="!autoUpdaterDisabled">
            <button
              v-if="!updateDownloaded"
              :disabled="!(!checkingForUpdate && !updateAvailable && !updateDownloaded)"
              class="update-check-button"
              @click="checkForUpdates"
            >
              <span class="material-symbols-outlined">update</span>Check for updates
            </button>
            <button v-if="updateDownloaded" class="update-button" @click="restartApplicationForUpdate">
              <span class="material-symbols-outlined">upgrade</span>Restart to update
            </button>
            <p v-if="checkingForUpdate && !updateAvailable && !updateDownloaded" class="updating">
              <span class="material-symbols-outlined">progress_activity</span>Checking for updates...
            </p>
            <p v-if="updateAvailable && !updateDownloaded" class="updating">
              <span class="material-symbols-outlined">progress_activity</span>Downloading update...
            </p>
            <p v-if="updateNotAvailable" class="no-update">Update not available</p>
          </template>
          <template v-if="autoUpdaterDisabled">
            <button disabled class="update-check-button"><span class="material-symbols-outlined">update</span>Check for updates</button>
            <p class="no-auto-updater">Auto updater disabled</p>
          </template>
          <span class="version-info">
            <p class="version">Version: {{ ytmdVersion }}</p>
            <p class="branch">Branch: {{ ytmdBranch }}</p>
            <p class="commit">Commit: {{ ytmdCommitHash }}</p>
          </span>
          <div class="links">
            <a href="https://github.com/RealWhyKnot/YTMDesktopPlus" target="_blank">GitHub</a>
          </div>
        </div>
      </div>
    </div>
    <div v-if="showCloseConfirm" class="close-confirm-overlay">
      <div class="close-confirm">
        <p class="title">Unsaved changes</p>
        <p class="body">Your changes have not been saved yet.</p>
        <div class="actions">
          <button class="keep-button" @click="keepEditing">Keep editing</button>
          <button class="discard-button" @click="discardAndClose">Discard and close</button>
          <button class="save-button" @click="saveAndClose">Save and close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-container {
  user-select: none;
}

.content-container {
  display: flex;
  height: 100%;
}

.content {
  overflow: auto;
  flex-grow: 1;
  padding: 4px 16px;
}

.content::-webkit-scrollbar {
  width: 12px;
}

.content::-webkit-scrollbar-track {
  background: #212121;
}

.content::-webkit-scrollbar-thumb {
  background-color: #414141;
}

.sidebar {
  width: 25%;
  min-width: 25%;
  list-style-type: none;
  margin: unset;
  padding: unset;
  height: 100%;
  border-right: 1px solid #212121;
  display: flex;
  flex-direction: column;
}

.sidebar li {
  display: flex;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  color: #bbbbbb;
}

.sidebar li .material-symbols-outlined {
  font-size: 28px;
  font-variation-settings:
    "FILL" 0,
    "wght" 100,
    "GRAD" 0,
    "opsz" 28;
}

.sidebar li:hover {
  background-color: #111111;
}

.sidebar li.active {
  background-color: #212121;
  color: #eeeeee;
}

.sidebar li .material-symbols-outlined {
  margin-right: 8px;
}

.sidebar .push {
  flex-grow: 1;
}

.setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.setting.indented {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid #212121;
}

.name-with-description .name {
  margin-bottom: unset;
}

.name-with-description .description {
  margin-top: 4px;
  color: #969696;
}

.about-tab {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-direction: column;
  height: 100%;
}

.icon {
  width: 128px;
  height: 128px;
  margin-bottom: 16px;
}

.app-name {
  margin: 0;
}

.version-info .version,
.version-info .branch,
.version-info .commit {
  margin: 4px 0;
  color: #bbbbbb;
}

.made-by {
  margin: 16px 0;
}

.links {
  margin-top: 32px;
  width: 100%;
  display: flex;
  justify-content: space-evenly;
}

.links a {
  color: #bbbbbb;
}

.restart-banner {
  background-color: #f44336;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.save-bar {
  background-color: #212121;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.save-bar .message {
  display: flex;
  align-items: center;
}

.save-bar .message .material-symbols-outlined {
  margin: 0 8px;
}

.save-bar .actions {
  display: flex;
  align-items: center;
}

.save-bar .reset-button {
  margin: 0 4px;
  background-color: transparent;
  border: 1px solid #888888;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
}

.save-bar .save-button,
.close-confirm .save-button {
  margin: 0 8px 0 4px;
  background-color: #f44336;
  border: none;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
}

.close-confirm-overlay {
  position: fixed;
  inset: 0;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.close-confirm {
  background-color: #111111;
  border: 1px solid #212121;
  border-radius: 8px;
  padding: 16px;
  max-width: 420px;
}

.close-confirm .title {
  margin: 0 0 8px 0;
  font-weight: 600;
}

.close-confirm .body {
  margin: 0 0 16px 0;
  color: #bbbbbb;
}

.close-confirm .actions {
  display: flex;
  justify-content: flex-end;
}

.close-confirm .keep-button,
.close-confirm .discard-button {
  background-color: transparent;
  border: 1px solid #888888;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
}

.restart-banner .message {
  display: flex;
  align-items: center;
}

.restart-banner .message .material-symbols-outlined {
  margin: 0 8px;
}

.restart-banner .restart-button {
  margin: 0 8px;
  background-color: transparent;
  border: 1px solid #ffffff;
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
}

.update-check-button {
  display: flex;
  align-items: center;
  background-color: transparent;
  border: 1px solid #ffffff;
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.update-check-button:disabled {
  border: 1px solid #888888;
  cursor: not-allowed;
}

.updating,
.no-update {
  display: flex;
  align-items: center;
  color: #888888;
  margin: 0 0 8px 0;
}

.no-auto-updater {
  display: flex;
  align-items: center;
  color: #888888;
  margin: 0 0 8px 0;
}

.updating .material-symbols-outlined {
  animation: rotation 1s infinite linear;
}

@keyframes rotation {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(359deg);
  }
}

.update-button {
  display: flex;
  align-items: center;
  background-color: #f44336;
  border: none;
  border-radius: 4px;
  padding: 4px 8px;
  margin-bottom: 8px;
  cursor: pointer;
}

.update-check-button .material-symbols-outlined,
.updating .material-symbols-outlined,
.update-button .material-symbols-outlined {
  margin-right: 4px;
}

.version-info {
  user-select: text;
}

.setting.disabled {
  color: #c6c6c6;
}

.authorized-companions-table {
  width: 100%;
  table-layout: fixed;
}

.authorized-companions-table tr .companion {
  width: 70%;
  word-wrap: break-word;
}

.authorized-companions-table tr .companion .id {
  color: #969696;
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
  border-bottom: 1px solid #212121;
}
.authorized-companions-table thead tr .controls {
  width: 48px;
}

.authorized-companions-table tbody button {
  border-radius: 4px;
  padding: 4px;
  display: flex;
  align-items: center;
  background-color: #212121;
  cursor: pointer;
  border: none;
}

.no-authorized-companions {
  color: #bbbbbb;
  padding: 4px;
}

.discord-failure {
  margin: 0;
  color: #969696;
}

button {
  margin: 3px 3px 3px 4px;
  border-radius: 4px;
  padding: 8px;
  display: flex;
  align-items: center;
  background-color: #212121;
  cursor: pointer;
  border: none;
}

.shortcuts-tab .shortcut-title {
  display: flex;
  justify-content: center;
  align-items: center;
}

.shortcuts-tab .shortcut-title .register-error {
  margin-left: 4px;
  color: #f44336;
}
</style>
