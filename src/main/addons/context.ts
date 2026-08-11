import log, { type LogFunctions } from "electron-log";
import fs from "fs";
import path from "path";
import type Conf from "conf";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type { AddonManifest, AddonSettingsSection, AddonTitlebarBadge } from "~shared/addons/types";
import type { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import type MemoryStore from "../memory-store";
import type { PlayerState } from "../player-state-store";
import type { RemoteTrackActivity } from "../integrations/discord-presence";
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
  invokeYtmScript(namespace: string, name: string, arg?: unknown): Promise<unknown>;
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
  createWindow(options: AddonWindowOptions): AddonHostWindow;
  discord: {
    registerButtonsProvider(provider: (trackShareUrl: string) => { label: string; url: string }[] | undefined): () => void;
    registerRemoteActivityProvider(provider: () => RemoteTrackActivity | undefined): () => void;
    refreshActivity(): void;
  };
  deepLinks: {
    register(command: string, handler: (segments: string[], params: URLSearchParams) => void): () => void;
  };
};

export type AddonWindowOptions = {
  /** Name of a renderer window folder compiled into the app (like "room") */
  entry: string;
  width: number;
  height: number;
  resizable?: boolean;
};

export type AddonHostWindow = {
  show(): void;
  focus(): void;
  close(): void;
  isDestroyed(): boolean;
  once(event: "closed", callback: () => void): void;
  webContents: Electron.WebContents;
};

export type AddonWindowHandle = {
  show(): void;
  close(): void;
  isOpen(): boolean;
  webContents(): Electron.WebContents | null;
};

/** Per-addon plumbing the manager owns: registries the context writes into. */
export type AddonHostBridge = {
  setSettingsSections(sections: AddonSettingsSection[]): void;
  addLoadedCallback(callback: () => void): Unsubscribe;
  addCssHandle(handle: AddonCssHandle): void;
  addCleanup(cleanup: () => void): void;
  setTitlebarBadge(badge: Omit<AddonTitlebarBadge, "addonId"> | null): void;
  addBadgeClickCallback(callback: () => void): Unsubscribe;
  addWindow(window: AddonHostWindow): void;
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
    /** Runs a registered script and resolves its return value. The script still
     *  evaluates to a function; it may take one structured-clone argument and
     *  return (or resolve) structured-clone data. Rejects on script error,
     *  missing view, or a 30s timeout. */
    invokeScript(name: string, arg?: unknown): Promise<unknown>;
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
  windows: {
    create(options: AddonWindowOptions): AddonWindowHandle;
  };
  deepLinks: {
    register(command: string, handler: (segments: string[], params: URLSearchParams) => void): Unsubscribe;
  };
  discord: {
    registerButtonsProvider(provider: (trackShareUrl: string) => { label: string; url: string }[] | undefined): Unsubscribe;
    /** Offers a track playing outside this app as a presence stand-in while
     *  local playback has nothing to show. Call refreshActivity after the
     *  provided value changes. */
    registerRemoteActivityProvider(provider: () => RemoteTrackActivity | undefined): Unsubscribe;
    refreshActivity(): void;
  };
  titlebar: {
    setBadge(badge: Omit<AddonTitlebarBadge, "addonId"> | null): void;
    onBadgeClick(callback: () => void): Unsubscribe;
  };
  /** Core store and memory-store access for the bundled rooms addon: it owns
   *  memory keys the room renderer reads and reacts to integration toggles
   *  that live outside the addon namespace. External addons should use
   *  ctx.settings and ctx.memory instead. */
  coreSettings: {
    get<T = unknown>(dottedKey: string): T;
    onDidChange(section: "integrations", callback: (next: StoreSchema["integrations"], prev: StoreSchema["integrations"]) => void): Unsubscribe;
  };
  coreMemory: {
    get<T = unknown>(key: keyof MemoryStoreSchema & string): T;
    set(key: keyof MemoryStoreSchema & string, value: unknown): void;
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
      invokeScript(name, arg) {
        return services.invokeYtmScript(scriptNamespace, name, arg);
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
    },

    windows: {
      create(options) {
        const window = services.createWindow(options);
        bridge.addWindow(window);
        let open = true;
        window.once("closed", () => {
          open = false;
        });
        return {
          show() {
            if (!open) return;
            window.show();
            window.focus();
          },
          close() {
            if (open) window.close();
          },
          isOpen: () => open && !window.isDestroyed(),
          webContents: () => (open && !window.isDestroyed() ? window.webContents : null)
        };
      }
    },

    deepLinks: {
      register(command, handler) {
        const unsubscribe = services.deepLinks.register(command, (segments, params) => {
          try {
            handler(segments, params);
          } catch (error) {
            scopedLog.error(`Deep link handler failed for ${command}`, error);
          }
        });
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      }
    },

    discord: {
      registerButtonsProvider(provider) {
        const unsubscribe = services.discord.registerButtonsProvider(trackShareUrl => {
          try {
            return provider(trackShareUrl);
          } catch (error) {
            scopedLog.error("Presence buttons provider failed", error);
            return undefined;
          }
        });
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
      registerRemoteActivityProvider(provider) {
        const unsubscribe = services.discord.registerRemoteActivityProvider(() => {
          try {
            return provider();
          } catch (error) {
            scopedLog.error("Remote activity provider failed", error);
            return undefined;
          }
        });
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
      refreshActivity() {
        services.discord.refreshActivity();
      }
    },

    titlebar: {
      setBadge(badge) {
        bridge.setTitlebarBadge(badge);
      },
      onBadgeClick(callback) {
        return bridge.addBadgeClickCallback(callback);
      }
    },

    coreSettings: {
      get<T>(dottedKey: string) {
        let current: unknown = services.store.store;
        for (const part of dottedKey.split(".")) {
          if (current === null || typeof current !== "object") return undefined as T;
          current = (current as Record<string, unknown>)[part];
        }
        return current as T;
      },
      onDidChange(section, callback) {
        const unsubscribe = services.store.onDidChange(section, (newValue, oldValue) => {
          if (newValue && oldValue) callback(newValue, oldValue);
        });
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      }
    },

    coreMemory: {
      get<T>(key: string) {
        return services.memoryStore.get(key) as T;
      },
      set(key, value) {
        services.memoryStore.set(key, value);
      }
    }
  };
}
