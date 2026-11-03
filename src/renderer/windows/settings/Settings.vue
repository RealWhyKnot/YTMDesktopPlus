<script setup lang="ts">
import type { AppWindow } from "../../app-window";
declare const window: AppWindow;
defineOptions({ name: "ApplicationSettings" });
import { computed, nextTick, provide, ref, type Component } from "vue";
import { type MemoryStoreSchema, type StoreSchema } from "~shared/store/schema";
import { type AuthToken } from "~shared/integrations/companion-server/types";
import { type AddonDescriptor } from "~shared/addons/sdk";
import { type ThemeDescriptor } from "~shared/themes/sdk";
import { createStagedSettings, stagedSettingsKey } from "./use-staged-settings";
import { settingsShellKey } from "./context";
import GeneralTab from "./tabs/GeneralTab.vue";
import AppearanceTab from "./tabs/AppearanceTab.vue";
import PlaybackTab from "./tabs/PlaybackTab.vue";
import IntegrationsTab from "./tabs/IntegrationsTab.vue";
import ShortcutsTab from "./tabs/ShortcutsTab.vue";
import AddonsTab from "./tabs/AddonsTab.vue";
import ThemesTab from "./tabs/ThemesTab.vue";
import AboutTab from "./tabs/AboutTab.vue";
import "./settings-controls.css";
import { isAuthToken } from "~shared/integrations/companion-server/validate-auth-token";
import { arrayOf } from "~shared/validation";

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

const safeStorageAvailable = ref<boolean | undefined>(await memoryStore.get("safeStorageAvailable"));

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
      if (field.type === "button") continue;
      addonSettingKeys.push(`addons.settings.${addon.manifest.id}.${field.key}`);
    }
  }
}

const staged = createStagedSettings(
  { general, developer, appearance, playback, integrations, shortcuts, lastfm: lastFM, updates, addons: addonsSection },
  (entries) => store.setMany(entries),
  addonSettingKeys
);
provide(stagedSettingsKey, staged);
const { hasUnsavedChanges, restartNeeded, saveChanges, resetChanges } = staged;

async function decryptAuthTokens(encrypted: string | null): Promise<AuthToken[]> {
  if (!safeStorageAvailable.value || encrypted === null) return [];
  try {
    const decrypted = await safeStorage.decryptString(encrypted);
    if (decrypted === null) return [];
    const tokens: unknown = JSON.parse(decrypted);
    return arrayOf(isAuthToken)(tokens) ? tokens : [];
  } catch {
    return [];
  }
}

const companionServerAuthTokens = ref<AuthToken[]>(await decryptAuthTokens(integrations.companionServerAuthTokens));
const companionServerSavedEnabled = ref<boolean>(integrations.companionServerEnabled);
const lastFMSessionKey = ref<string | null>(lastFM.sessionKey);

async function applyStoreState(newState: StoreSchema) {
  staged.applyExternalState(newState);
  companionServerSavedEnabled.value = newState.integrations.companionServerEnabled;

  companionServerAuthTokens.value = await decryptAuthTokens(newState.integrations.companionServerAuthTokens);
  lastFMSessionKey.value = newState.lastfm.sessionKey;
}

store.onDidAnyChange((newState) => {
  void applyStoreState(newState).catch((error: unknown) => console.error("Settings could not be refreshed", error));
});

const discordPresenceConnectionFailed = ref<boolean | undefined>(await memoryStore.get("discordPresenceConnectionFailed"));

const shortcutRegisterFailed = {
  playPause: ref<boolean | undefined>(await memoryStore.get("shortcutsPlayPauseRegisterFailed")),
  next: ref<boolean | undefined>(await memoryStore.get("shortcutsNextRegisterFailed")),
  previous: ref<boolean | undefined>(await memoryStore.get("shortcutsPreviousRegisterFailed")),
  thumbsUp: ref<boolean | undefined>(await memoryStore.get("shortcutsThumbsUpRegisterFailed")),
  thumbsDown: ref<boolean | undefined>(await memoryStore.get("shortcutsThumbsDownRegisterFailed")),
  volumeUp: ref<boolean | undefined>(await memoryStore.get("shortcutsVolumeUpRegisterFailed")),
  volumeDown: ref<boolean | undefined>(await memoryStore.get("shortcutsVolumeDownRegisterFailed")),
};

const companionServerAuthWindowEnabled = ref<boolean | undefined>(await memoryStore.get("companionServerAuthWindowEnabled"));

const autoUpdaterDisabled = ref<boolean | undefined>(await memoryStore.get("autoUpdaterDisabled"));
const updateLatestVersion = ref<string | undefined>(await memoryStore.get("appUpdateLatestVersion"));

const hasAddonsSupport = window.ytmd.addons !== undefined;
const addons = ref<AddonDescriptor[]>(initialAddons);
const addonRestartPending = computed(() => addons.value.some((addon) => addon.restartRequired));

function setAddonEnabled(id: string, isEnabled: boolean) {
  const update = window.ytmd.addons?.setEnabled(id, isEnabled);
  if (update !== undefined) void update.catch((error: unknown) => console.error("Addon setting could not be saved", error));
}

function openAddonsFolder() {
  window.ytmd.addons?.openFolder();
}

const hasThemesSupport = window.ytmd.themes !== undefined;
const themes = ref<ThemeDescriptor[]>(window.ytmd.themes ? await window.ytmd.themes.getAll() : []);
const themeError = ref<string | null>(null);

async function runThemeAction(action: () => Promise<{ ok: boolean; reason?: string }>) {
  const result = await action();
  themeError.value = result.ok || result.reason === "cancelled" ? null : (result.reason ?? "that did not work");
  if (window.ytmd.themes) themes.value = await window.ytmd.themes.getAll();
}

async function setActiveTheme(id: string | null) {
  await runThemeAction(() => themeBridge().setActive(id));
}

function themeBridge() {
  const bridge = window.ytmd.themes;
  if (bridge === undefined) throw new Error("Themes are unavailable");
  return bridge;
}

async function createTheme() {
  await runThemeAction(() => themeBridge().create());
}

async function rescanThemes() {
  if (window.ytmd.themes) themes.value = await window.ytmd.themes.rescan();
}

async function duplicateTheme(id: string) {
  await runThemeAction(() => themeBridge().duplicate(id));
}

async function exportTheme(id: string) {
  await runThemeAction(() => themeBridge().exportTheme(id));
}

async function installThemeFromFile() {
  await runThemeAction(() => themeBridge().installFromFile());
}

function openThemesFolder() {
  window.ytmd.themes?.openFolder();
}

async function applyMemoryState(newState: Partial<MemoryStoreSchema>) {
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
  updateLatestVersion.value = newState.appUpdateLatestVersion;

  if (newState.themesRuntime) {
    themes.value = newState.themesRuntime;
  }

  if (newState.addonsRuntime) {
    addons.value = newState.addonsRuntime;

    const missing: string[] = [];
    for (const addon of newState.addonsRuntime) {
      for (const section of addon.settingsSections) {
        for (const field of section.fields) {
          if (field.type === "button") continue;
          const key = `addons.settings.${addon.manifest.id}.${field.key}`;
          if (!(key in staged.refs)) missing.push(key);
        }
      }
    }
    if (missing.length > 0) {
      staged.addKeys(missing, { addons: await store.get("addons") });
    }
  }
}

memoryStore.onStateChanged((newState) => {
  void applyMemoryState(newState).catch((error: unknown) => console.error("Settings status could not be refreshed", error));
});

function memorySettingsChanged() {
  memoryStore.set("companionServerAuthWindowEnabled", companionServerAuthWindowEnabled.value);
}

function restartDiscordPresence() {
  store.set("integrations.discordPresenceEnabled", false);
  store.set("integrations.discordPresenceEnabled", true);
}

async function deleteCompanionAuthToken(appId: string) {
  const index = companionServerAuthTokens.value.findIndex((token) => token.appId === appId);
  if (index > -1) {
    companionServerAuthTokens.value.splice(index, 1);
  }

  if (safeStorageAvailable.value)
    store.set("integrations.companionServerAuthTokens", await safeStorage.encryptString(JSON.stringify(companionServerAuthTokens.value)));
}

function connectLastFM() {
  store.set("integrations.lastFMEnabled", false);
  store.set("integrations.lastFMEnabled", true);
  staged.markSavedValue("integrations.lastFMEnabled", true);
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
  if (hasUnsavedChanges.value) {
    openCloseConfirm("update");
    return;
  }
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
  updateLatestVersion,
  discordPresenceConnectionFailed,
  shortcutRegisterFailed,
  companionServerAuthWindowEnabled,
  companionServerSavedEnabled,
  companionServerAuthTokens,
  lastFMSessionKey,
  addons,
  setAddonEnabled,
  openAddonsFolder,
  themes,
  themeError,
  setActiveTheme,
  createTheme,
  rescanThemes,
  duplicateTheme,
  exportTheme,
  installThemeFromFile,
  openThemesFolder,
  memorySettingsChanged,
  restartDiscordPresence,
  deleteCompanionAuthToken,
  logoutLastFM,
  connectLastFM,
});

type TabDefinition = { id: string; icon: string; label: string; component: Component; bottom?: boolean };
const tabs: TabDefinition[] = [
  { id: "general", icon: "settings_applications", label: "General", component: GeneralTab },
  { id: "appearance", icon: "brush", label: "Appearance", component: AppearanceTab },
  { id: "playback", icon: "music_note", label: "Playback", component: PlaybackTab },
  { id: "integrations", icon: "wifi_tethering", label: "Integrations", component: IntegrationsTab },
  { id: "shortcuts", icon: "keyboard", label: "Shortcuts", component: ShortcutsTab },
  ...(hasThemesSupport ? [{ id: "themes", icon: "palette", label: "Themes", component: ThemesTab }] : []),
  ...(hasAddonsSupport ? [{ id: "addons", icon: "extension", label: "Addons", component: AddonsTab }] : []),
  { id: "about", icon: "info", label: "About", component: AboutTab, bottom: true },
];
const currentTab = ref("general");
const activeTab = computed(() => {
  const tab = tabs.find((candidate) => candidate.id === currentTab.value);
  if (tab === undefined) throw new Error("Selected settings tab is unavailable");
  return tab;
});
function selectTab(index: number) {
  const tab = tabs[(index + tabs.length) % tabs.length];
  if (tab === undefined) return;
  currentTab.value = tab.id;
  document.getElementById(`settings-tab-${tab.id}`)?.focus();
}

function tabKeyDown(event: KeyboardEvent, index: number) {
  switch (event.key) {
    case "ArrowDown":
    case "ArrowRight":
      selectTab(index + 1);
      break;
    case "ArrowUp":
    case "ArrowLeft":
      selectTab(index - 1);
      break;
    case "Home":
      selectTab(0);
      break;
    case "End":
      selectTab(tabs.length - 1);
      break;
    default:
      return;
  }
  event.preventDefault();
}

const showCloseConfirm = ref(false);
const closeIntent = ref<"close" | "update">("close");
const closeConfirmDialog = ref<HTMLElement | null>(null);
let canClose = false;
let focusBeforeConfirm: HTMLElement | null = null;

function openCloseConfirm(intent: "close" | "update") {
  closeIntent.value = intent;
  if (!showCloseConfirm.value) {
    focusBeforeConfirm = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    focusBeforeConfirm?.blur();
  }
  showCloseConfirm.value = true;
  void nextTick(() => closeConfirmDialog.value?.querySelector<HTMLElement>(".save-button")?.focus()).catch((error: unknown) =>
    console.error("Save button could not receive focus", error)
  );
}

function closeConfirmKeyDown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    keepEditing();
    return;
  }
  if (event.key !== "Tab" || !closeConfirmDialog.value) return;
  const buttons = [...closeConfirmDialog.value.querySelectorAll<HTMLElement>("button")];
  if (buttons.length === 0) return;
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (first === undefined || last === undefined) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  } else if (!buttons.some((button) => button === document.activeElement)) {
    event.preventDefault();
    first.focus();
  }
}

window.onbeforeunload = (event: BeforeUnloadEvent) => {
  if (hasUnsavedChanges.value && !canClose) {
    event.preventDefault();
    openCloseConfirm("close");
  }
};

function keepEditing() {
  showCloseConfirm.value = false;
  const target = focusBeforeConfirm;
  focusBeforeConfirm = null;
  if (target?.isConnected) target.focus();
}

function discardAndClose() {
  if (closeIntent.value === "update") {
    resetChanges();
    showCloseConfirm.value = false;
    window.ytmd.restartApplicationForUpdate();
    return;
  }
  canClose = true;
  window.ytmd.closeWindow();
}

function saveAndClose() {
  saveChanges();
  if (closeIntent.value === "update") {
    showCloseConfirm.value = false;
    window.ytmd.restartApplicationForUpdate();
    return;
  }
  canClose = true;
  window.ytmd.closeWindow();
}
</script>

<template>
  <div class="settings-container">
    <div class="content-container">
      <div class="sidebar" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
        <template v-for="(tab, index) in tabs" :key="tab.id">
          <span v-if="tab.bottom" class="push" aria-hidden="true"></span>
          <button
            :id="`settings-tab-${tab.id}`"
            type="button"
            role="tab"
            class="tab"
            :title="tab.label"
            :aria-selected="currentTab === tab.id"
            :aria-controls="`settings-panel-${tab.id}`"
            :tabindex="currentTab === tab.id ? 0 : -1"
            @click="currentTab = tab.id"
            @keydown="tabKeyDown($event, index)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{ tab.icon }}</span
            ><span class="label">{{ tab.label }}</span>
          </button>
        </template>
      </div>
      <div class="content">
        <div :id="`settings-panel-${currentTab}`" class="tab-panels" role="tabpanel" :aria-labelledby="`settings-tab-${currentTab}`">
          <KeepAlive>
            <component :is="activeTab.component" />
          </KeepAlive>
        </div>
        <div v-if="hasUnsavedChanges" class="save-bar">
          <p class="message"><span class="material-symbols-outlined">edit</span> You have unsaved changes</p>
          <div class="actions">
            <button class="reset-button" @click="resetChanges">Reset</button>
            <button class="save-button" @click="saveChanges">Save changes</button>
          </div>
        </div>
        <div v-else-if="restartNeeded || addonRestartPending" class="restart-banner">
          <p class="message"><span class="material-symbols-outlined">autorenew</span> Restart app to apply changes</p>
          <button class="restart-button" @click="restartApplication">Restart</button>
        </div>
      </div>
    </div>
    <div v-if="showCloseConfirm" class="close-confirm-overlay" @keydown="closeConfirmKeyDown">
      <div
        ref="closeConfirmDialog"
        class="close-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="close-confirm-title"
        aria-describedby="close-confirm-body"
      >
        <p id="close-confirm-title" class="title">Unsaved changes</p>
        <p id="close-confirm-body" class="body">
          {{ closeIntent === "update" ? "Save or discard your changes before the app restarts to update." : "Your changes have not been saved yet." }}
        </p>
        <div class="actions">
          <button class="keep-button" @click="keepEditing">Keep editing</button>
          <button class="discard-button" @click="discardAndClose">{{ closeIntent === "update" ? "Discard and restart" : "Discard and close" }}</button>
          <button class="save-button" @click="saveAndClose">{{ closeIntent === "update" ? "Save and restart" : "Save and close" }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped src="./settings-layout.css"></style>
