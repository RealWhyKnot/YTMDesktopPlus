import log from "electron-log";
import fs from "fs";
import path from "path";
import type {
  AddonActiveTheme,
  AddonContext,
  AddonIpcEvent,
  AddonIpcInvokeEvent,
  AddonManifest,
  AddonSettingsSection,
  AddonTitlebarBadge,
  AddonTrayMenuItem,
  AddonWindowOptions,
  AddonWebContents,
  CueRequest,
  CueResult,
  PlayerEventName,
  PlayerEventMap,
  PlayerQueue,
  PlayerState,
  RemoteCommandName,
  RemoteTrackActivity,
  Unsubscribe,
  YTMRepeatMode,
} from "~shared/addons/sdk";
import type { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { AddonCssHandle, cssHandleFromFile } from "./css";
import { clampBadge, clampNumberSetting, correctNumberSetting, numberFieldBounds, type NumberBounds } from "./settings-values";
import { isRecord } from "~shared/unknown";

export const HOST_SCRIPT_NAMESPACE = "addon-host";

export type AddonStore = {
  get(key: "addons"): StoreSchema["addons"];
  set(key: "addons", value: StoreSchema["addons"]): void;
  onDidChange(key: "addons", callback: (newValue?: StoreSchema["addons"], oldValue?: StoreSchema["addons"]) => void): () => void;
  readonly store: Pick<StoreSchema, "addons">;
};

export type AddonMemoryStore = {
  get(key: keyof MemoryStoreSchema): unknown;
  set(key: keyof MemoryStoreSchema, value: unknown): void;
};

export type AddonHostServices = {
  store: AddonStore;
  memoryStore: AddonMemoryStore;
  appVersion: string;
  userDataPath: string;
  getYtmView: () => { webContents: Pick<Electron.WebContents, "send" | "insertCSS" | "removeInsertedCSS"> } | null;
  registerYtmScript(namespace: string, name: string, script: string): void;
  invokeYtmScript(namespace: string, name: string, arg?: unknown): Promise<unknown>;
  player: {
    getState(): PlayerState;
    getQueue(): PlayerQueue | null;
    getPlaylistId(): string | null | undefined;
    addEventListener(listener: (state: PlayerState) => void): void;
    removeEventListener(listener: (state: PlayerState) => void): void;
    events: {
      on<K extends PlayerEventName>(event: K, listener: (payload: PlayerEventMap[K]) => void): void;
      off<K extends PlayerEventName>(event: K, listener: (payload: PlayerEventMap[K]) => void): void;
    };
  };
  playback: {
    cueTrack(request: CueRequest): Promise<CueResult>;
    sendPlaybackCommand(command: RemoteCommandName, value?: unknown): boolean;
    getPlaylists(): Promise<{ id: string; title: string }[]>;
  };
  ipc: {
    handle(channel: string, listener: (event: AddonIpcInvokeEvent, ...args: unknown[]) => unknown): void;
    removeHandler(channel: string): void;
    on(channel: string, listener: (event: AddonIpcEvent, ...args: unknown[]) => void): void;
    removeListener(channel: string, listener: (event: AddonIpcEvent, ...args: unknown[]) => void): void;
  };
  isAppSender(sender: AddonWebContents): boolean;
  notify(options: { title: string; body?: string; onClick?: () => void }): void;

  refreshTrayMenu(): void;

  createWindow(options: AddonWindowOptions & { addonId: string; filePath?: string }): AddonHostWindow;
  discord: {
    isEnabled(): boolean;
    onEnabledChanged(callback: (enabled: boolean) => void): () => void;
    registerButtonsProvider(provider: () => { label: string; url: string }[] | undefined): () => void;
    registerRemoteActivityProvider(provider: () => RemoteTrackActivity | undefined): () => void;
    refreshActivity(): void;
  };
  deepLinks: {
    register(command: string, handler: (segments: string[], params: URLSearchParams) => void): () => void;
  };
  theme: {
    get(): AddonActiveTheme;
    subscribe(listener: (theme: AddonActiveTheme) => void): () => void;
  };
};

export type AddonHostWindow = {
  show(): void;
  focus(): void;
  close(): void;
  isDestroyed(): boolean;
  once(event: "closed", callback: () => void): void;
  webContents: AddonWebContents;
};

export type AddonHostBridge = {
  setSettingsSections(sections: AddonSettingsSection[]): void;
  addLoadedCallback(callback: () => void): Unsubscribe;
  addCssHandle(handle: AddonCssHandle): void;
  addCleanup(cleanup: () => void): void;
  setTitlebarBadge(badge: Omit<AddonTitlebarBadge, "addonId"> | null): void;
  addBadgeClickCallback(callback: () => void): Unsubscribe;
  addActionCallback(key: string, callback: () => void): Unsubscribe;
  addMessageCallback(name: string, callback: (payload: unknown) => void): Unsubscribe;
  setTrayMenuItems(items: AddonTrayMenuItem[]): void;
  addWindow(window: AddonHostWindow): void;

  reportError(source: string, error: unknown): void;
};

export function createAddonContext(manifest: AddonManifest, services: AddonHostServices, bridge: AddonHostBridge, addonDir?: string): AddonContext {
  const id = manifest.id;
  const scopedLog = log.scope(`addon:${id}`);
  const scriptNamespace = `addon:${id}`;
  const dataPath = path.join(services.userDataPath, "addon-data", id);
  fs.mkdirSync(dataPath, { recursive: true });

  const settingsOf = (state: Pick<StoreSchema, "addons">): Record<string, unknown> => state.addons.settings[id] ?? {};

  const reportError = (source: string, error: unknown) => {
    scopedLog.error(`${source} failed`, error);
    bridge.reportError(source, error);
  };

  const guard = <A extends unknown[]>(source: string, fn: (...args: A) => unknown): ((...args: A) => void) => {
    return (...args: A) => {
      try {
        const result = fn(...args);
        if (result instanceof Promise) result.catch((error: unknown) => reportError(source, error));
      } catch (error) {
        reportError(source, error);
      }
    };
  };

  const needsView = (what: string) =>
    services.getYtmView() === null ? Promise.reject(new Error(`${what} can't run until the YouTube Music page loads; call it from ytmview.onLoaded`)) : null;

  const defaults = new Map<string, unknown>();
  let numberBounds = new Map<string, NumberBounds>();
  let isNumberGuardInstalled = false;

  const correctNumber = (key: string, value: unknown, previous: unknown) => {
    const bounds = numberBounds.get(key);
    return bounds ? correctNumberSetting(value, bounds, [previous, defaults.get(key)]) : { changed: false, value };
  };

  const correctStoredNumbers = (previous?: Record<string, unknown>) => {
    const addonsSection = services.store.get("addons");
    const target = addonsSection.settings[id];
    if (!target) return;
    let isChanged = false;
    for (const key of numberBounds.keys()) {
      const correction = correctNumber(key, target[key], previous?.[key]);
      if (!correction.changed) continue;
      target[key] = correction.value;
      isChanged = true;
    }
    if (isChanged) services.store.set("addons", addonsSection);
  };

  return {
    manifest,
    log: scopedLog,
    paths: { data: dataPath },
    app: { version: services.appVersion },

    settings: {
      registerDefaults(newDefaults) {
        const addonsSection = services.store.get("addons");
        const target = addonsSection.settings[id] ?? {};
        let isChanged = false;
        for (const [key, value] of Object.entries(newDefaults)) {
          defaults.set(key, value);
          if (target[key] === undefined) {
            target[key] = value;
            isChanged = true;
          }
        }
        if (isChanged) {
          addonsSection.settings[id] = target;
          services.store.set("addons", addonsSection);
        }
      },
      get(key) {
        return settingsOf(services.store.store)[key];
      },
      set(key, value) {
        const bounds = numberBounds.get(key);
        if (bounds && typeof value === "number") {
          if (!Number.isFinite(value)) throw new TypeError(`${key} must be a finite number`);
          value = clampNumberSetting(value, bounds);
        }
        const addonsSection = services.store.get("addons");
        const target = addonsSection.settings[id] ?? {};
        target[key] = value;
        addonsSection.settings[id] = target;
        services.store.set("addons", addonsSection);
      },
      onDidChange(key, callback) {
        const guarded = guard(`settings.onDidChange(${key})`, callback);
        let delivered = settingsOf(services.store.store)[key];
        const unsubscribe = services.store.onDidChange("addons", (newValue) => {
          const next = newValue?.settings[id]?.[key];
          if (Object.is(next, delivered) || correctNumber(key, next, delivered).changed) return;
          const prev = delivered;
          delivered = next;
          guarded(next, prev);
        });
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
      registerSettingsUI(sections) {
        numberBounds = numberFieldBounds(sections);
        bridge.setSettingsSections(sections);
        if (!isNumberGuardInstalled) {
          isNumberGuardInstalled = true;
          bridge.addCleanup(services.store.onDidChange("addons", (_newValue, oldValue) => correctStoredNumbers(oldValue?.settings[id])));
        }
        correctStoredNumbers();
      },
      onAction(key, callback) {
        return bridge.addActionCallback(key, guard(`settings.onAction(${key})`, callback));
      },
    },

    memory: {
      get(key) {
        const all = services.memoryStore.get("addonMemory");
        const values = isRecord(all) ? all[id] : undefined;
        return isRecord(values) ? values[key] : undefined;
      },
      set(key, value) {
        const stored = services.memoryStore.get("addonMemory");
        const all = isRecord(stored) ? { ...stored } : {};
        const values = all[id];
        all[id] = { ...(isRecord(values) ? values : {}), [key]: value };
        services.memoryStore.set("addonMemory", all);
      },
    },

    ytmview: {
      registerScript(name, script) {
        services.registerYtmScript(scriptNamespace, name, script);
      },
      runScript(name) {
        services.getYtmView()?.webContents.send("ytmView:executeScript", scriptNamespace, name);
      },
      invokeScript(name, arg) {
        return needsView("ytmview.invokeScript") ?? services.invokeYtmScript(scriptNamespace, name, arg);
      },
      onLoaded(callback) {
        return bridge.addLoadedCallback(guard("ytmview.onLoaded", callback));
      },
      onMessage(name, callback) {
        return bridge.addMessageCallback(name, guard(`ytmview.onMessage(${name})`, callback));
      },
      insertCSS(css) {
        const handle = new AddonCssHandle(services.getYtmView, scopedLog, css);
        bridge.addCssHandle(handle);
        void handle.apply().catch((error: unknown) => log.warn("insertCSS failed", error));
        return handle;
      },
      watchCSSFile(filePath) {
        const handle = cssHandleFromFile(services.getYtmView, scopedLog, filePath);
        bridge.addCssHandle(handle);
        void handle.apply().catch((error: unknown) => log.warn("watchCSSFile failed", error));
        return handle;
      },
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
      },
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
      cueTrack: (request) => services.playback.cueTrack(request),
      sendPlaybackCommand: (command, value) => services.playback.sendPlaybackCommand(command, value),
      getPlaylists: () => services.playback.getPlaylists(),
    },

    ipc: {
      handle(channel, listener) {
        const fullChannel = `addon:${id}:${channel}`;

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
        const guarded = (event: AddonIpcEvent, ...args: unknown[]) => {
          if (!services.isAppSender(event.sender)) return;
          safeListener(event, ...args);
        };
        services.ipc.on(fullChannel, guarded);
        const unsubscribe = () => services.ipc.removeListener(fullChannel, guarded);
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
    },

    innertube: {
      request(endpoint, body) {
        return needsView("innertube.request") ?? services.invokeYtmScript(HOST_SCRIPT_NAMESPACE, "innertubeRequest", { endpoint, body });
      },
    },

    notifications: {
      show(options) {
        services.notify(options);
      },
    },

    windows: {
      create(options) {
        if ((options.entry ? 1 : 0) + (options.file ? 1 : 0) !== 1) {
          throw new Error("windows.create needs exactly one of entry or file");
        }
        if (options.entry && addonDir) throw new Error("only bundled addons can open entry windows; use file instead");
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
        let isOpen = true;
        window.once("closed", () => {
          isOpen = false;
        });

        if (filePath) {
          const closeChannel = `addon:${id}:window:close`;
          const onCloseRequest = (event: AddonIpcEvent) => {
            if (!isOpen || window.isDestroyed()) return;
            if (event.sender !== window.webContents) return;
            window.close();
          };
          services.ipc.on(closeChannel, onCloseRequest);
          window.once("closed", () => services.ipc.removeListener(closeChannel, onCloseRequest));
        }

        return {
          show() {
            if (!isOpen) return;
            window.show();
            window.focus();
          },
          close() {
            if (isOpen) window.close();
          },
          isOpen: () => isOpen && !window.isDestroyed(),
          webContents: () => (isOpen && !window.isDestroyed() ? window.webContents : null),
          send(channel, ...args) {
            if (isOpen && !window.isDestroyed()) window.webContents.send(`addon:${id}:${channel}`, ...args);
          },
        };
      },
    },

    deepLinks: {
      register(command, handler) {
        const unsubscribe = services.deepLinks.register(command, guard(`deepLinks(${command})`, handler));
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
    },

    theme: {
      get() {
        return services.theme.get();
      },
      onChanged(callback) {
        const unsubscribe = services.theme.subscribe(guard("theme.onChanged", callback));
        bridge.addCleanup(unsubscribe);
        return unsubscribe;
      },
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
        const unsubscribe = services.discord.registerButtonsProvider(() => {
          try {
            return provider();
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
      },
    },

    titlebar: {
      setBadge(badge) {
        bridge.setTitlebarBadge(clampBadge(badge));
      },
      onBadgeClick(callback) {
        return bridge.addBadgeClickCallback(guard("titlebar.onBadgeClick", callback));
      },
    },

    tray: {
      setMenuItems(items) {
        bridge.setTrayMenuItems(items.map((item) => ({ ...item, click: guard("tray.item", () => item.click()) })));
      },
    },
  };
}
