import type { InjectionKey, Ref } from "vue";
import type { AuthToken } from "~shared/integrations/companion-server/types";
import type { AddonDescriptor } from "~shared/addons/types";

// Everything the tab components need from the window shell beyond the staged
// settings themselves. Provided once by Settings.vue.
export type SettingsShell = {
  isDarwin: boolean;
  isLinux: boolean;

  ytmdVersion: string;
  ytmdBranch: string;
  ytmdCommitHash: string;

  checkingForUpdate: Ref<boolean>;
  updateAvailable: Ref<boolean>;
  updateNotAvailable: Ref<boolean>;
  updateDownloaded: Ref<boolean>;
  checkForUpdates(): void;
  restartApplicationForUpdate(): void;

  safeStorageAvailable: Ref<boolean>;
  autoUpdaterDisabled: Ref<boolean>;
  discordPresenceConnectionFailed: Ref<boolean>;
  shortcutRegisterFailed: Record<string, Ref<boolean>>;
  companionServerAuthWindowEnabled: Ref<boolean>;

  companionServerAuthTokens: Ref<AuthToken[]>;
  lastFMSessionKey: Ref<string>;

  addons: Ref<AddonDescriptor[]>;
  setAddonEnabled(id: string, enabled: boolean): void;
  openAddonsFolder(): void;

  memorySettingsChanged(): void;
  restartDiscordPresence(): void;
  deleteCompanionAuthToken(appId: string): Promise<void>;
  logoutLastFM(): void;
};

export const settingsShellKey: InjectionKey<SettingsShell> = Symbol("settings-shell");
