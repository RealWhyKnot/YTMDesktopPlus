import { inject, type InjectionKey, type Ref } from "vue";
import type { StoreSchema } from "~shared/store/schema";
import type { AuthToken } from "~shared/integrations/companion-server/types";
import type { AddonDescriptor } from "~shared/addons/sdk";
import type { ThemeDescriptor } from "~shared/themes/sdk";

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
  checkForUpdates: () => void;
  restartApplicationForUpdate: () => void;

  safeStorageAvailable: Ref<boolean | undefined>;
  autoUpdaterDisabled: Ref<boolean | undefined>;
  updateLatestVersion: Ref<string | undefined>;
  discordPresenceConnectionFailed: Ref<boolean | undefined>;
  shortcutRegisterFailed: Record<keyof StoreSchema["shortcuts"], Ref<boolean | undefined>>;
  companionServerAuthWindowEnabled: Ref<boolean | undefined>;
  companionServerSavedEnabled: Ref<boolean>;

  companionServerAuthTokens: Ref<AuthToken[]>;
  lastFMSessionKey: Ref<string | null>;

  addons: Ref<AddonDescriptor[]>;
  setAddonEnabled: (id: string, enabled: boolean) => void;
  openAddonsFolder: () => void;

  themes: Ref<ThemeDescriptor[]>;
  themeError: Ref<string | null>;
  setActiveTheme: (id: string | null) => Promise<void>;
  createTheme: () => Promise<void>;
  rescanThemes: () => Promise<void>;
  duplicateTheme: (id: string) => Promise<void>;
  exportTheme: (id: string) => Promise<void>;
  installThemeFromFile: () => Promise<void>;
  openThemesFolder: () => void;

  memorySettingsChanged: () => void;
  restartDiscordPresence: () => void;
  deleteCompanionAuthToken: (appId: string) => Promise<void>;
  logoutLastFM: () => void;
  connectLastFM: () => void;
};

export const settingsShellKey: InjectionKey<SettingsShell> = Symbol("settings-shell");

export function useSettingsShell(): SettingsShell {
  const shell = inject(settingsShellKey);
  if (shell === undefined) throw new Error("Settings shell provider is missing");
  return shell;
}
