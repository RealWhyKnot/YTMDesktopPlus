<script setup lang="ts">
import { computed, provide, ref, type Component } from "vue";
import { StoreSchema } from "~shared/store/schema";
import { AuthToken } from "~shared/integrations/companion-server/types";
import { AddonDescriptor } from "~shared/addons/types";
import { createStagedSettings, stagedSettingsKey } from "./useStagedSettings";
import { settingsShellKey } from "./context";
import GeneralTab from "./tabs/GeneralTab.vue";
import AppearanceTab from "./tabs/AppearanceTab.vue";
import PlaybackTab from "./tabs/PlaybackTab.vue";
import IntegrationsTab from "./tabs/IntegrationsTab.vue";
import ShortcutsTab from "./tabs/ShortcutsTab.vue";
import AddonsTab from "./tabs/AddonsTab.vue";
import AboutTab from "./tabs/AboutTab.vue";

declare const YTMD_GIT_COMMIT_HASH: string;
declare const YTMD_GIT_BRANCH: string;

const ytmdVersion = await window.ytmd.getAppVersion();
const ytmdCommitHash = YTMD_GIT_COMMIT_HASH.substring(0, 7);
const ytmdBranch = YTMD_GIT_BRANCH;

const isDarwin = window.ytmd.isDarwin;
const isLinux = window.ytmd.isLinux;

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
const addonsSection: StoreSchema["addons"] = await store.get("addons");

const initialAddons: AddonDescriptor[] = window.ytmd.addons ? await window.ytmd.addons.getAll() : [];
const addonSettingKeys: string[] = [];
for (const addon of initialAddons) {
  for (const section of addon.settingsSections) {
    for (const field of section.fields) {
      addonSettingKeys.push(`addons.settings.${addon.manifest.id}.${field.key}`);
    }
  }
}

const staged = createStagedSettings(
  { general, developer, appearance, playback, integrations, shortcuts, lastfm: lastFM, updates, addons: addonsSection },
  entries => store.setMany(entries),
  addonSettingKeys
);
provide(stagedSettingsKey, staged);
const { hasUnsavedChanges, restartNeeded, saveChanges, resetChanges } = staged;

const companionServerAuthTokens = ref<AuthToken[]>(
  safeStorageAvailable.value ? (JSON.parse(await safeStorage.decryptString(integrations.companionServerAuthTokens)) ?? []) : []
);
const lastFMSessionKey = ref<string>(lastFM.sessionKey);

store.onDidAnyChange(async newState => {
  staged.applyExternalState(newState);

  companionServerAuthTokens.value = safeStorageAvailable.value
    ? (JSON.parse(await safeStorage.decryptString(newState.integrations.companionServerAuthTokens)) ?? [])
    : [];
  lastFMSessionKey.value = newState.lastfm.sessionKey;
});

const discordPresenceConnectionFailed = ref<boolean>(await memoryStore.get("discordPresenceConnectionFailed"));

const shortcutRegisterFailed = {
  playPause: ref<boolean>(await memoryStore.get("shortcutsPlayPauseRegisterFailed")),
  next: ref<boolean>(await memoryStore.get("shortcutsNextRegisterFailed")),
  previous: ref<boolean>(await memoryStore.get("shortcutsPreviousRegisterFailed")),
  thumbsUp: ref<boolean>(await memoryStore.get("shortcutsThumbsUpRegisterFailed")),
  thumbsDown: ref<boolean>(await memoryStore.get("shortcutsThumbsDownRegisterFailed")),
  volumeUp: ref<boolean>(await memoryStore.get("shortcutsVolumeUpRegisterFailed")),
  volumeDown: ref<boolean>(await memoryStore.get("shortcutsVolumeDownRegisterFailed"))
};

const companionServerAuthWindowEnabled = ref<boolean>(await memoryStore.get("companionServerAuthWindowEnabled"));

const autoUpdaterDisabled = ref<boolean>(await memoryStore.get("autoUpdaterDisabled"));

const addonsSupported = window.ytmd.addons !== undefined;
const addons = ref<AddonDescriptor[]>(initialAddons);
const addonRestartPending = computed(() => addons.value.some(addon => addon.restartRequired));

function setAddonEnabled(id: string, enabled: boolean) {
  window.ytmd.addons?.setEnabled(id, enabled);
}

function openAddonsFolder() {
  window.ytmd.addons?.openFolder();
}

memoryStore.onStateChanged(async newState => {
  discordPresenceConnectionFailed.value = newState.discordPresenceConnectionFailed;

  shortcutRegisterFailed.playPause.value = newState.shortcutsPlayPauseRegisterFailed;
  shortcutRegisterFailed.next.value = newState.shortcutsNextRegisterFailed;
  shortcutRegisterFailed.previous.value = newState.shortcutsPreviousRegisterFailed;
  shortcutRegisterFailed.thumbsUp.value = newState.shortcutsThumbsUpRegisterFailed;
  shortcutRegisterFailed.thumbsDown.value = newState.shortcutsThumbsDownRegisterFailed;
  shortcutRegisterFailed.volumeUp.value = newState.shortcutsVolumeUpRegisterFailed;
  shortcutRegisterFailed.volumeDown.value = newState.shortcutsVolumeDownRegisterFailed;

  companionServerAuthWindowEnabled.value = newState.companionServerAuthWindowEnabled;

  safeStorageAvailable.value = newState.safeStorageAvailable;

  autoUpdaterDisabled.value = newState.autoUpdaterDisabled;

  if (newState.addonsRuntime) {
    addons.value = newState.addonsRuntime;

    // An addon can register its settings UI after this window opened; those
    // keys join the staged set so their fields bind instead of crashing.
    const missing: string[] = [];
    for (const addon of newState.addonsRuntime) {
      for (const section of addon.settingsSections) {
        for (const field of section.fields) {
          const key = `addons.settings.${addon.manifest.id}.${field.key}`;
          if (!(key in staged.refs)) missing.push(key);
        }
      }
    }
    if (missing.length > 0) {
      staged.addKeys(missing, { addons: await store.get("addons") });
    }
  }
});

async function memorySettingsChanged() {
  memoryStore.set("companionServerAuthWindowEnabled", companionServerAuthWindowEnabled.value);
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

function logoutLastFM() {
  store.set("lastfm.sessionKey", null);
  store.set("integrations.lastFMEnabled", false);
  staged.markSavedValue("integrations.lastFMEnabled", false);
  lastFMSessionKey.value = null;
}

function restartApplication() {
  window.ytmd.restartApplication();
}

function restartApplicationForUpdate() {
  window.ytmd.restartApplicationForUpdate();
}

function checkForUpdates() {
  window.ytmd.checkForUpdates();
  checkingForUpdate.value = true;
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

provide(settingsShellKey, {
  isDarwin,
  isLinux,
  ytmdVersion,
  ytmdBranch,
  ytmdCommitHash,
  checkingForUpdate,
  updateAvailable,
  updateNotAvailable,
  updateDownloaded,
  checkForUpdates,
  restartApplicationForUpdate,
  safeStorageAvailable,
  autoUpdaterDisabled,
  discordPresenceConnectionFailed,
  shortcutRegisterFailed,
  companionServerAuthWindowEnabled,
  companionServerAuthTokens,
  lastFMSessionKey,
  addons,
  setAddonEnabled,
  openAddonsFolder,
  memorySettingsChanged,
  restartDiscordPresence,
  deleteCompanionAuthToken,
  logoutLastFM
});

type TabDefinition = { id: string; icon: string; label: string; component: Component; bottom?: boolean };
const tabs: TabDefinition[] = [
  { id: "general", icon: "settings_applications", label: "General", component: GeneralTab },
  { id: "appearance", icon: "brush", label: "Appearance", component: AppearanceTab },
  { id: "playback", icon: "music_note", label: "Playback", component: PlaybackTab },
  { id: "integrations", icon: "wifi_tethering", label: "Integrations", component: IntegrationsTab },
  { id: "shortcuts", icon: "keyboard", label: "Shortcuts", component: ShortcutsTab },
  ...(addonsSupported ? [{ id: "addons", icon: "extension", label: "Addons", component: AddonsTab }] : []),
  { id: "about", icon: "info", label: "About", component: AboutTab, bottom: true }
];
const currentTab = ref("general");
const activeTab = computed(() => tabs.find(tab => tab.id === currentTab.value));

const showCloseConfirm = ref(false);
let allowClose = false;

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
</script>

<template>
  <div class="settings-container">
    <div class="content-container">
      <ul class="sidebar">
        <template v-for="tab in tabs" :key="tab.id">
          <span v-if="tab.bottom" class="push"></span>
          <li :class="{ active: currentTab === tab.id }" :title="tab.label" @click="currentTab = tab.id">
            <span class="material-symbols-outlined">{{ tab.icon }}</span
            ><span class="label">{{ tab.label }}</span>
          </li>
        </template>
      </ul>
      <div class="content">
        <div class="tab-panels">
          <KeepAlive>
            <component :is="activeTab.component" />
          </KeepAlive>
        </div>
        <div v-if="hasUnsavedChanges" class="save-bar">
          <p class="message"><span class="material-symbols-outlined">edit</span> You have unsaved changes</p>
          <div class="actions">
            <button class="reset-button" @click="resetChanges">Reset</button>
            <button class="save-button" @click="saveChanges">Save Changes</button>
          </div>
        </div>
        <div v-else-if="restartNeeded || addonRestartPending" class="restart-banner">
          <p class="message"><span class="material-symbols-outlined">autorenew</span> Restart app to apply changes</p>
          <button class="restart-button" @click="restartApplication">Restart</button>
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

<style>
/* Shared look for the plain controls and rows the tab components render.
   Deliberately unscoped so it reaches them; kept under .settings-container. */
.settings-container button {
  margin: 3px 3px 3px 4px;
  border-radius: 4px;
  padding: 8px;
  display: flex;
  align-items: center;
  background-color: var(--bg-control);
  cursor: pointer;
  border: none;
}

.settings-container .setting {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.settings-container .setting.indented {
  margin-left: 12px;
  padding-left: 12px;
  border-left: 1px solid var(--border);
}

.settings-container .setting.disabled {
  color: #c6c6c6;
}

.settings-container .name-with-description .name {
  margin-bottom: unset;
}

.settings-container .name-with-description .description {
  margin-top: 4px;
  color: var(--text-faint);
}
</style>

<style scoped>
.settings-container {
  user-select: none;
}

.content-container {
  display: flex;
  height: 100%;
}

.content {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  min-width: 0;
  overflow: hidden;
}

/* The panels scroll; the save bar and restart banner sit below as fixed
   footers so they stay visible on long tabs */
.tab-panels {
  flex: 1 1 auto;
  overflow: auto;
  padding: 4px 16px;
}

.tab-panels::-webkit-scrollbar {
  width: 12px;
}

.tab-panels::-webkit-scrollbar-track {
  background: var(--bg-control);
}

.tab-panels::-webkit-scrollbar-thumb {
  background-color: #414141;
}

.sidebar {
  flex: 0 0 190px;
  list-style-type: none;
  margin: unset;
  padding: unset;
  height: 100%;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.sidebar li {
  display: flex;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  color: var(--text-muted);
}

.sidebar li .label {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (max-width: 660px) {
  .sidebar {
    flex-basis: 56px;
  }

  .sidebar li {
    justify-content: center;
    padding: 16px 0;
  }

  .sidebar li .label {
    display: none;
  }

  .sidebar li .material-symbols-outlined {
    margin-right: 0;
  }
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
  background-color: var(--bg-raised);
}

.sidebar li.active {
  background-color: var(--bg-control);
  color: var(--text);
}

.sidebar li .material-symbols-outlined {
  margin-right: 8px;
}

.sidebar .push {
  flex-grow: 1;
}

.restart-banner {
  background-color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 8px;
}

.save-bar {
  background-color: var(--bg-control);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 8px;
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
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
}

.save-bar .save-button,
.close-confirm .save-button {
  margin: 0 8px 0 4px;
  background-color: var(--accent);
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
  background-color: var(--bg-raised);
  border: 1px solid var(--border);
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
  color: var(--text-muted);
}

.close-confirm .actions {
  display: flex;
  justify-content: flex-end;
}

.close-confirm .keep-button,
.close-confirm .discard-button {
  background-color: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 4px;
  padding: 8px 16px;
  cursor: pointer;
}
</style>
