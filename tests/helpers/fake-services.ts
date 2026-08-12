import { EventEmitter } from "events";
import { vi } from "vitest";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { makeTempDir } from "./temp-dir";
import type { AddonHostServices, AddonHostWindow } from "../../src/main/addons/context";
import type { StoreSchema } from "../../src/shared/store/schema";
import type { CueResult } from "../../src/shared/addons/sdk";
import { makePlayerState } from "./fake-addon-context";

/** A complete, compiler-checked services bag for AddonManager tests. The
 *  object is typed against the real AddonHostServices with no whole-object
 *  cast, so a new required service breaks this file at compile time. */
export function fakeServices(persistedStates: Record<string, { enabled: boolean }> = {}, appVersion = "2026.811.0") {
  const stored: Record<string, unknown> = { addons: { states: persistedStates, settings: {} } };
  const storeListeners: ((newValue: unknown, oldValue: unknown) => void)[] = [];
  const memory = new Map<string, unknown>();
  const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const ipcListeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
  const registeredScripts: Record<string, Record<string, string>> = {};
  const windows: AddonHostWindow[] = [];
  const playerEvents = new EventEmitter();
  let appSender = true;

  function fakeWindow(): AddonHostWindow {
    let destroyed = false;
    const closedCallbacks: (() => void)[] = [];
    const window: AddonHostWindow = {
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(() => {
        destroyed = true;
        for (const callback of closedCallbacks) callback();
      }),
      isDestroyed: () => destroyed,
      once: (_event, callback) => {
        closedCallbacks.push(callback);
      },
      webContents: { id: windows.length + 1, send: vi.fn(), isDestroyed: () => destroyed } as unknown as Electron.WebContents
    };
    return window;
  }

  const services: AddonHostServices = {
    store: {
      // Like conf, reads hand out copies: mutating a get() result never
      // changes stored state until it is set() back.
      get: <K extends keyof StoreSchema>(key: K) => structuredClone(stored[key]) as StoreSchema[K],
      set: (key: string, value: unknown) => {
        const old = structuredClone(stored[key]);
        stored[key] = structuredClone(value);
        if (key === "addons") for (const listener of storeListeners) listener(stored[key], old);
      },
      onDidChange: <K extends keyof StoreSchema>(_key: K, callback: (newValue?: StoreSchema[K], oldValue?: StoreSchema[K]) => void) => {
        const listener = callback as (newValue: unknown, oldValue: unknown) => void;
        storeListeners.push(listener);
        return () => {
          storeListeners.splice(storeListeners.indexOf(listener), 1);
        };
      },
      get store() {
        return structuredClone(stored) as StoreSchema;
      }
    },
    memoryStore: {
      get: (key: string) => memory.get(key),
      set: (key: string, value: unknown) => memory.set(key, value)
    },
    appVersion,
    userDataPath: makeTempDir("ytmd-addon-test-"),
    getYtmView: () => null,
    registerYtmScript: (namespace: string, name: string, script: string) => {
      if (!registeredScripts[namespace]) registeredScripts[namespace] = {};
      registeredScripts[namespace][name] = script;
    },
    invokeYtmScript: vi.fn(async () => undefined),
    player: {
      getState: () => makePlayerState(),
      getQueue: () => null,
      getPlaylistId: () => null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      events: {
        on: (event, listener) => {
          playerEvents.on(event, listener);
        },
        off: (event, listener) => {
          playerEvents.off(event, listener);
        }
      }
    },
    playback: {
      cueTrack: vi.fn(async (): Promise<CueResult> => "no-view"),
      sendPlaybackCommand: vi.fn(() => true),
      getPlaylists: vi.fn(async () => [])
    },
    ipc: {
      handle: (channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, listener as (event: unknown, ...args: unknown[]) => unknown);
      },
      removeHandler: (channel: string) => {
        ipcHandlers.delete(channel);
      },
      on: (channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void) => {
        ipcListeners.set(channel, listener as (event: unknown, ...args: unknown[]) => void);
      },
      removeListener: (channel: string) => {
        ipcListeners.delete(channel);
      }
    },
    isAppSender: () => appSender,
    notify: vi.fn(),
    refreshTrayMenu: vi.fn(),
    createWindow: vi.fn(() => {
      const window = fakeWindow();
      windows.push(window);
      return window;
    }),
    discord: {
      isEnabled: vi.fn(() => false),
      onEnabledChanged: vi.fn(() => () => {}),
      registerButtonsProvider: vi.fn(() => () => {}),
      registerRemoteActivityProvider: vi.fn(() => () => {}),
      refreshActivity: vi.fn()
    },
    deepLinks: {
      register: vi.fn(() => () => {})
    }
  };

  return {
    services,
    stored: stored as { addons: { states: Record<string, { enabled: boolean }>; settings: Record<string, Record<string, unknown>> } },
    memory,
    ipcHandlers,
    ipcListeners,
    registeredScripts,
    windows,
    playerEvents,
    setAppSender: (value: boolean) => {
      appSender = value;
    }
  };
}
