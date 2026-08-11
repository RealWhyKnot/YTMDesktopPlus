import log, { type LogFunctions } from "electron-log";
import fs from "fs";
import path from "path";
import type Conf from "conf";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type { AddonManifest, AddonSettingsSection } from "~shared/addons/types";
import type { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import type MemoryStore from "../memory-store";
import type { PlayerState } from "../player-state-store";
import type { cueTrack } from "../playback";
import { AddonCssHandle, cssHandleFromFile } from "./css";

export type Unsubscribe = () => void;

export interface AddonInstance {
  destroy?(): void | Promise<void>;
}

/** Everything the host hands the addon runtime. Assembled once in the main
 *  entry point; the manager and contexts never reach for globals themselves. */
export type AddonHostServices = {
  store: Conf<StoreSchema>;
  memoryStore: MemoryStore<MemoryStoreSchema>;
  appVersion: string;
  userDataPath: string;
  getYtmView(): { webContents: Electron.WebContents } | null;
  registerYtmScript(namespace: string, name: string, script: string): void;
  player: {
    getState(): PlayerState;
    addEventListener(listener: (state: PlayerState) => void): void;
    removeEventListener(listener: (state: PlayerState) => void): void;
  };
  playback: {
    cueTrack: typeof cueTrack;
    sendPlaybackCommand(command: string, value?: unknown): void;
  };
  ipc: {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
    on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void;
    removeListener(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void;
  };
  isAppSender(sender: Electron.WebContents): boolean;
  notify(options: { title: string; body?: string; onClick?: () => void }): void;
};

/** Per-addon plumbing the manager owns: registries the context writes into. */
export type AddonHostBridge = {
  setSettingsSections(sections: AddonSettingsSection[]): void;
  addLoadedCallback(callback: () => void): Unsubscribe;
  addCssHandle(handle: AddonCssHandle): void;
  addCleanup(cleanup: () => void): void;
};

export interface AddonContext {
  readonly manifest: AddonManifest;
  readonly log: LogFunctions;
  readonly paths: { data: string };
  readonly app: { version: string };
  settings: {
    registerDefaults(defaults: Record<string, unknown>): void;
    get<T = unknown>(key: string): T;
    set(key: string, value: unknown): void;
    onDidChange(key: string, callback: (next: unknown, prev: unknown) => void): Unsubscribe;
    registerSettingsUI(sections: AddonSettingsSection[]): void;
  };
  memory: {
    get<T = unknown>(key: string): T;
    set(key: string, value: unknown): void;
  };
  ytmview: {
    registerScript(name: string, script: string): void;
    runScript(name: string): void;
    onLoaded(callback: () => void): Unsubscribe;
    insertCSS(css: string): AddonCssHandle;
    watchCSSFile(filePath: string): AddonCssHandle;
  };
  player: {
    getState(): PlayerState;
    onStateChanged(callback: (state: PlayerState) => void): Unsubscribe;
  };
  playback: AddonHostServices["playback"];
  ipc: {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): Unsubscribe;
    on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): Unsubscribe;
  };
  notifications: {
    show(options: { title: string; body?: string; onClick?: () => void }): void;
  };
}

export function createAddonContext(manifest: AddonManifest, services: AddonHostServices, bridge: AddonHostBridge): AddonContext {
  const id = manifest.id;
  const scopedLog = log.scope(`addon:${id}`);
  const scriptNamespace = `addon:${id}`;
  const dataPath = path.join(services.userDataPath, "addon-data", id);
  fs.mkdirSync(dataPath, { recursive: true });

  const settingsOf = (state: StoreSchema): Record<string, unknown> => state.addons.settings[id] ?? {};

  return {
    manifest,
    log: scopedLog,
    paths: { data: dataPath },
    app: { version: services.appVersion },

    settings: {
      registerDefaults(defaults) {
        const addonsSection = services.store.get("addons");
        const target = addonsSection.settings[id] ?? {};
        let changed = false;
        for (const [key, value] of Object.entries(defaults)) {
          if (target[key] === undefined) {
            target[key] = value;
            changed = true;
          }
        }
        if (changed) {
          addonsSection.settings[id] = target;
          services.store.set("addons", addonsSection);
        }
      },
      get<T>(key: string) {
        return settingsOf(services.store.store)[key] as T;
      },
      set(key, value) {
        const addonsSection = services.store.get("addons");
        const target = addonsSection.settings[id] ?? {};
        target[key] = value;
        addonsSection.settings[id] = target;
        services.store.set("addons", addonsSection);
      },
      onDidChange(key, callback) {
        const unsubscribe = services.store.onDidChange("addons", (newValue, oldValue) => {
          const next = newValue?.settings[id]?.[key];
          const prev = oldValue?.settings[id]?.[key];
          if (!Object.is(next, prev)) callback(next, prev);
        });
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
      registerSettingsUI(sections) {
        bridge.setSettingsSections(sections);
      }
    },

    memory: {
      get<T>(key: string) {
        const all = (services.memoryStore.get("addonMemory") ?? {}) as Record<string, Record<string, unknown>>;
        return all[id]?.[key] as T;
      },
      set(key, value) {
        const all = { ...((services.memoryStore.get("addonMemory") ?? {}) as Record<string, Record<string, unknown>>) };
        all[id] = { ...all[id], [key]: value };
        services.memoryStore.set("addonMemory", all);
      }
    },

    ytmview: {
      registerScript(name, script) {
        services.registerYtmScript(scriptNamespace, name, script);
      },
      runScript(name) {
        services.getYtmView()?.webContents.send("ytmView:executeScript", scriptNamespace, name);
      },
      onLoaded(callback) {
        return bridge.addLoadedCallback(callback);
      },
      insertCSS(css) {
        const handle = new AddonCssHandle(services.getYtmView, scopedLog, css);
        bridge.addCssHandle(handle);
        handle.apply();
        return handle;
      },
      watchCSSFile(filePath) {
        const handle = cssHandleFromFile(services.getYtmView, scopedLog, filePath);
        bridge.addCssHandle(handle);
        handle.apply();
        return handle;
      }
    },

    player: {
      getState() {
        return services.player.getState();
      },
      onStateChanged(callback) {
        services.player.addEventListener(callback);
        const unsubscribe = () => services.player.removeEventListener(callback);
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      }
    },

    playback: services.playback,

    ipc: {
      handle(channel, listener) {
        const fullChannel = `addon:${id}:${channel}`;
        services.ipc.handle(fullChannel, (event, ...args) => {
          if (!services.isAppSender(event.sender)) return;
          return listener(event, ...args);
        });
        const unsubscribe = () => services.ipc.removeHandler(fullChannel);
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
      on(channel, listener) {
        const fullChannel = `addon:${id}:${channel}`;
        const guarded = (event: IpcMainEvent, ...args: unknown[]) => {
          if (!services.isAppSender(event.sender)) return;
          listener(event, ...args);
        };
        services.ipc.on(fullChannel, guarded);
        const unsubscribe = () => services.ipc.removeListener(fullChannel, guarded);
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      }
    },

    notifications: {
      show(options) {
        services.notify(options);
      }
    }
  };
}
