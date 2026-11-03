import type { WindowsEventArguments } from "~shared/types";
import type { Store } from "./store-ipc/store";
import type { StoreSchema, MemoryStoreSchema } from "~shared/store/schema";
import type { MemoryStore } from "./store-ipc/memory-store";
import type { AddonDescriptor } from "~shared/addons/sdk";
import type { ThemeDescriptor, ThemeActionResult } from "~shared/themes/sdk";
import type { ThemeBridge } from "./windows/theme-bridge";

export type AppWindow = Window & {
  ytmd: {
    isDarwin: boolean;
    isLinux: boolean;
    isWindows: boolean;
    store: Store<StoreSchema>;
    memoryStore: MemoryStore<MemoryStoreSchema>;
    safeStorage: {
      decryptString: (value: string) => Promise<string | null>;
      encryptString: (value: string) => Promise<string>;
    };
    openSettingsWindow: () => void;
    openRoomWindow: () => void;
    addons?: {
      getAll: () => Promise<AddonDescriptor[]>;
      setEnabled: (id: string, enabled: boolean) => Promise<void>;
      openFolder: () => void;
      invokeAction: (id: string, key: string) => void;
      openHomepage: (id: string) => void;
      getRecentLog: (id: string) => Promise<string[]>;
    };
    theme?: ThemeBridge;
    themes?: {
      getAll: () => Promise<ThemeDescriptor[]>;
      rescan: () => Promise<ThemeDescriptor[]>;
      setActive: (id: string | null) => Promise<ThemeActionResult>;
      create: () => Promise<ThemeActionResult>;
      duplicate: (id: string) => Promise<ThemeActionResult>;
      exportTheme: (id: string) => Promise<ThemeActionResult>;
      installFromFile: () => Promise<ThemeActionResult>;
      openFolder: () => void;
    };
    addonBadgeClick?: (addonId: string) => void;
    restartApplication: () => void;
    restartApplicationForUpdate: () => void;
    getTrueFilePath: (file: File) => string;

    sendResult: (authorized: boolean) => void;
    getAppName: () => Promise<string>;
    getCode: () => Promise<string>;

    switchFocus: (context: "main" | "ytm") => void;

    ytmViewNavigateDefault: () => void;
    ytmViewRecreate: () => void;

    roomHost: (displayName: string) => void;
    roomJoin: (roomId: string, displayName: string) => void;
    roomLeave: () => void;
    roomDismissJoinPrompt: () => void;
    roomGrant: (memberId: string, role: number) => void;
    roomControl: (action: string, value?: unknown) => void;
    roomResume: () => void;

    minimizeWindow: () => void;
    maximizeWindow: () => void;
    restoreWindow: () => void;
    closeWindow: () => void;
    handleWindowEvents: (callback: (event: Electron.IpcRendererEvent, args: WindowsEventArguments) => void) => void;
    requestWindowState: () => void;

    getAppVersion: () => Promise<string>;
    checkForUpdates: () => void;
    handleCheckingForUpdate: (callback: (event: Electron.IpcRendererEvent) => void) => void;
    handleUpdateAvailable: (callback: (event: Electron.IpcRendererEvent) => void) => void;
    handleUpdateNotAvailable: (callback: (event: Electron.IpcRendererEvent) => void) => void;
    handleUpdateDownloaded: (callback: (event: Electron.IpcRendererEvent) => void) => void;
    isAppUpdateAvailable: () => Promise<boolean>;
    isAppUpdateDownloaded: () => Promise<boolean>;
  };
  navigator: Navigator & {
    windowControlsOverlay: {
      visible: boolean;
      addEventListener(event: "geometrychange", listener: (event: { visible: boolean }) => void): void;
    };
  };
};
