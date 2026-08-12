import log from "electron-log";
import fs from "fs";
import path from "path";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type {
  AddonContext,
  AddonManifest,
  AddonSettingsSection,
  AddonTitlebarBadge,
  AddonTrayMenuItem,
  AddonWindowOptions,
  CueRequest,
  CueResult,
  PlayerEventName,
  PlayerQueue,
  PlayerState,
  RemoteCommandName,
  RemoteTrackActivity,
  Unsubscribe,
  YTMRepeatMode
} from "~shared/addons/sdk";
import type { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { AddonCssHandle, cssHandleFromFile } from "./css";

export type { AddonContext, AddonInstance, AddonWindowHandle, AddonWindowOptions, Unsubscribe } from "~shared/addons/sdk";

/** Namespace for page scripts the host registers itself; addon namespaces are
 *  always addon:<id>, so this can never collide. */
export const HOST_SCRIPT_NAMESPACE = "addon-host";

/** The slice of the settings store the addon system needs. The real conf
 *  instance satisfies it; tests satisfy it with a plain object. */
export interface AddonStore {
  get<K extends keyof StoreSchema>(key: K): StoreSchema[K];
  set<K extends keyof StoreSchema>(key: K, value: StoreSchema[K]): void;
  onDidChange<K extends keyof StoreSchema>(key: K, callback: (newValue?: StoreSchema[K], oldValue?: StoreSchema[K]) => void): () => void;
  readonly store: StoreSchema;
}

/** The slice of the in-memory store the addon system touches. */
export interface AddonMemoryStore {
  get(key: keyof MemoryStoreSchema & string): unknown;
  set(key: keyof MemoryStoreSchema & string, value: unknown): void;
}

/** Everything the host hands the addon runtime. Assembled once in the main
 *  entry point; the manager and contexts never reach for globals themselves. */
export type AddonHostServices = {
  store: AddonStore;
  memoryStore: AddonMemoryStore;
  appVersion: string;
  userDataPath: string;
  getYtmView(): { webContents: Electron.WebContents } | null;
  registerYtmScript(namespace: string, name: string, script: string): void;
  invokeYtmScript(namespace: string, name: string, arg?: unknown): Promise<unknown>;
  player: {
    getState(): PlayerState;
    getQueue(): PlayerQueue | null;
    getPlaylistId(): string | null;
    addEventListener(listener: (state: PlayerState) => void): void;
    removeEventListener(listener: (state: PlayerState) => void): void;
    events: {
      on(event: PlayerEventName, listener: (payload: unknown) => void): void;
      off(event: PlayerEventName, listener: (payload: unknown) => void): void;
    };
  };
  playback: {
    cueTrack(request: CueRequest): Promise<CueResult>;
    sendPlaybackCommand(command: RemoteCommandName, value?: unknown): boolean;
    getPlaylists(): Promise<{ id: string; title: string }[]>;
  };
  ipc: {
    handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
    on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void;
    removeListener(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void;
  };
  isAppSender(sender: Electron.WebContents): boolean;
  notify(options: { title: string; body?: string; onClick?: () => void }): void;
  /** Rebuilds the tray menu from its template plus every addon's items. */
  refreshTrayMenu(): void;
  /** filePath is the pre-resolved absolute path for file windows; the context
   *  owns containment validation before it gets here. */
  createWindow(options: AddonWindowOptions & { addonId: string; filePath?: string }): AddonHostWindow;
  discord: {
    isEnabled(): boolean;
    onEnabledChanged(callback: (enabled: boolean) => void): () => void;
    registerButtonsProvider(provider: (trackShareUrl: string) => { label: string; url: string }[] | undefined): () => void;
    registerRemoteActivityProvider(provider: () => RemoteTrackActivity | undefined): () => void;
    refreshActivity(): void;
  };
  deepLinks: {
    register(command: string, handler: (segments: string[], params: URLSearchParams) => void): () => void;
  };
};

export type AddonHostWindow = {
  show(): void;
  focus(): void;
  close(): void;
  isDestroyed(): boolean;
  once(event: "closed", callback: () => void): void;
  webContents: Electron.WebContents;
};

/** Per-addon plumbing the manager owns: registries the context writes into. */
export type AddonHostBridge = {
  setSettingsSections(sections: AddonSettingsSection[]): void;
  addLoadedCallback(callback: () => void): Unsubscribe;
  addCssHandle(handle: AddonCssHandle): void;
  addCleanup(cleanup: () => void): void;
  setTitlebarBadge(badge: Omit<AddonTitlebarBadge, "addonId"> | null): void;
  addBadgeClickCallback(callback: () => void): Unsubscribe;
  addActionCallback(key: string, callback: () => void): Unsubscribe;
  setTrayMenuItems(items: AddonTrayMenuItem[]): void;
  addWindow(window: AddonHostWindow): void;
  /** Records a runtime failure on the descriptor so the settings card shows it. */
  reportError(source: string, error: unknown): void;
};

/** Internal superset handed to bundled addons; absent from the published SDK.
 *  Rooms owns memory keys its renderer reads and reacts to integration
 *  toggles that live outside the addon namespace. External addons use
 *  ctx.settings and ctx.memory instead. */
export interface BundledAddonContext extends AddonContext {
  coreSettings: {
    get<T = unknown>(dottedKey: string): T;
    onDidChange(section: "integrations", callback: (next: StoreSchema["integrations"], prev: StoreSchema["integrations"]) => void): Unsubscribe;
  };
  coreMemory: {
    get<T = unknown>(key: keyof MemoryStoreSchema & string): T;
    set(key: keyof MemoryStoreSchema & string, value: unknown): void;
  };
}

export function createAddonContext(manifest: AddonManifest, services: AddonHostServices, bridge: AddonHostBridge, addonDir?: string): BundledAddonContext {
  const id = manifest.id;
  const scopedLog = log.scope(`addon:${id}`);
  const scriptNamespace = `addon:${id}`;
  const dataPath = path.join(services.userDataPath, "addon-data", id);
  fs.mkdirSync(dataPath, { recursive: true });

  const settingsOf = (state: StoreSchema): Record<string, unknown> => state.addons.settings[id] ?? {};

  const reportError = (source: string, error: unknown) => {
    scopedLog.error(`${source} failed`, error);
    bridge.reportError(source, error);
  };

  // An addon callback that throws (or rejects) is contained here: the failure
  // lands on the descriptor and in the log instead of inside a host emitter.
  const guard = <A extends unknown[]>(source: string, fn: (...args: A) => unknown): ((...args: A) => void) => {
    return (...args: A) => {
      try {
        const result = fn(...args);
        if (result instanceof Promise) result.catch(error => reportError(source, error));
      } catch (error) {
        reportError(source, error);
      }
    };
  };

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
        const guarded = guard(`settings.onDidChange(${key})`, callback);
        const unsubscribe = services.store.onDidChange("addons", (newValue, oldValue) => {
          const next = newValue?.settings[id]?.[key];
          const prev = oldValue?.settings[id]?.[key];
          if (!Object.is(next, prev)) guarded(next, prev);
        });
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
      registerSettingsUI(sections) {
        bridge.setSettingsSections(sections);
      },
      onAction(key, callback) {
        return bridge.addActionCallback(key, callback);
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
      getQueue() {
        return services.player.getQueue();
      },
      getPlaylistId() {
        return services.player.getPlaylistId();
      },
      onStateChanged(callback) {
        const guarded = guard("player.onStateChanged", callback);
        services.player.addEventListener(guarded);
        const unsubscribe = () => services.player.removeEventListener(guarded);
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
      on(event, callback) {
        const guarded = guard(`player.on(${event})`, callback);
        services.player.events.on(event, guarded);
        const unsubscribe = () => services.player.events.off(event, guarded);
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      }
    },

    playback: {
      play: () => services.playback.sendPlaybackCommand("play"),
      pause: () => services.playback.sendPlaybackCommand("pause"),
      playPause: () => services.playback.sendPlaybackCommand("playPause"),
      next: () => services.playback.sendPlaybackCommand("next"),
      previous: () => services.playback.sendPlaybackCommand("previous"),
      toggleLike: () => services.playback.sendPlaybackCommand("toggleLike"),
      toggleDislike: () => services.playback.sendPlaybackCommand("toggleDislike"),
      setVolume: (volume: number) => services.playback.sendPlaybackCommand("setVolume", volume),
      volumeUp: () => services.playback.sendPlaybackCommand("volumeUp"),
      volumeDown: () => services.playback.sendPlaybackCommand("volumeDown"),
      mute: () => services.playback.sendPlaybackCommand("mute"),
      unmute: () => services.playback.sendPlaybackCommand("unmute"),
      seekTo: (seconds: number) => services.playback.sendPlaybackCommand("seekTo", seconds),
      setRepeatMode: (mode: YTMRepeatMode) => services.playback.sendPlaybackCommand("repeatMode", mode),
      shuffle: () => services.playback.sendPlaybackCommand("shuffle"),
      playQueueIndex: (index: number) => services.playback.sendPlaybackCommand("playQueueIndex", index),
      cueTrack: request => services.playback.cueTrack(request),
      sendPlaybackCommand: (command, value) => services.playback.sendPlaybackCommand(command, value),
      getPlaylists: () => services.playback.getPlaylists()
    },

    ipc: {
      handle(channel, listener) {
        const fullChannel = `addon:${id}:${channel}`;
        // A throw still rejects the renderer's invoke promise; it is recorded
        // on the way through rather than swallowed.
        services.ipc.handle(fullChannel, (event, ...args) => {
          if (!services.isAppSender(event.sender)) return;
          try {
            const result = listener(event, ...args);
            if (result instanceof Promise) {
              return result.catch((error: unknown) => {
                reportError(`ipc.handle(${channel})`, error);
                throw error;
              });
            }
            return result;
          } catch (error) {
            reportError(`ipc.handle(${channel})`, error);
            throw error;
          }
        });
        const unsubscribe = () => services.ipc.removeHandler(fullChannel);
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
      on(channel, listener) {
        const fullChannel = `addon:${id}:${channel}`;
        const safeListener = guard(`ipc.on(${channel})`, listener);
        const guarded = (event: IpcMainEvent, ...args: unknown[]) => {
          if (!services.isAppSender(event.sender)) return;
          safeListener(event, ...args);
        };
        services.ipc.on(fullChannel, guarded);
        const unsubscribe = () => services.ipc.removeListener(fullChannel, guarded);
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      }
    },

    innertube: {
      request<T>(endpoint: string, body?: Record<string, unknown>) {
        return services.invokeYtmScript(HOST_SCRIPT_NAMESPACE, "innertubeRequest", { endpoint, body }) as Promise<T>;
      }
    },

    notifications: {
      show(options) {
        services.notify(options);
      }
    },

    windows: {
      create(options) {
        if ((options.entry ? 1 : 0) + (options.file ? 1 : 0) !== 1) {
          throw new Error("windows.create needs exactly one of entry or file");
        }
        let filePath: string | undefined;
        if (options.file) {
          if (!addonDir) throw new Error("file windows need an addon folder; bundled addons use entry");
          const resolved = path.resolve(addonDir, options.file);
          const relative = path.relative(addonDir, resolved);
          if (relative.startsWith("..") || path.isAbsolute(relative)) {
            throw new Error("file must stay inside the addon folder");
          }
          filePath = resolved;
        }

        const window = services.createWindow({ ...options, addonId: id, filePath });
        bridge.addWindow(window);
        let open = true;
        window.once("closed", () => {
          open = false;
        });

        if (filePath) {
          // The bridge's closeWindow() lands here, scoped to this window.
          const closeChannel = `addon:${id}:window:close`;
          const onCloseRequest = (event: IpcMainEvent) => {
            if (!open || window.isDestroyed()) return;
            if (event.sender !== window.webContents) return;
            window.close();
          };
          services.ipc.on(closeChannel, onCloseRequest);
          window.once("closed", () => services.ipc.removeListener(closeChannel, onCloseRequest));
        }

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
          webContents: () => (open && !window.isDestroyed() ? window.webContents : null),
          send(channel, ...args) {
            if (open && !window.isDestroyed()) window.webContents.send(`addon:${id}:${channel}`, ...args);
          }
        };
      }
    },

    deepLinks: {
      register(command, handler) {
        const unsubscribe = services.deepLinks.register(command, guard(`deepLinks(${command})`, handler));
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      }
    },

    discord: {
      isEnabled() {
        return services.discord.isEnabled();
      },
      onEnabledChanged(callback) {
        const unsubscribe = services.discord.onEnabledChanged(guard("discord.onEnabledChanged", callback));
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
      registerButtonsProvider(provider) {
        const unsubscribe = services.discord.registerButtonsProvider(trackShareUrl => {
          try {
            return provider(trackShareUrl);
          } catch (error) {
            reportError("discord.buttonsProvider", error);
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
            reportError("discord.remoteActivityProvider", error);
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

    tray: {
      setMenuItems(items) {
        bridge.setTrayMenuItems(items);
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
      get<T>(key: keyof MemoryStoreSchema & string) {
        return services.memoryStore.get(key) as T;
      },
      set(key, value) {
        services.memoryStore.set(key, value);
      }
    }
  };
}
