import { EventEmitter } from "events";
import { vi } from "vitest";
import { makeTempDir } from "./temp-dir";
import type { AddonHostServices, AddonHostWindow } from "../../src/main/addons/context";
import type { StoreSchema } from "../../src/shared/store/schema";
import type { AddonIpcEvent, AddonIpcInvokeEvent, AddonWebContents, CueResult } from "../../src/shared/addons/sdk";
import { makePlayerState } from "./fake-addon-context";

export function fakeAddonContents(id = 0) {
  return { id, send: vi.fn<AddonWebContents["send"]>(), isDestroyed: () => false };
}

export function fakeAddonEvent(sender: AddonWebContents = fakeAddonContents()) {
  return { sender, reply: vi.fn<AddonIpcEvent["reply"]>() };
}

export function fakeAddonView() {
  return {
    webContents: {
      send: vi.fn<AddonWebContents["send"]>(),
      insertCSS: vi.fn(() => Promise.resolve("fixture-css")),
      removeInsertedCSS: vi.fn(() => Promise.resolve()),
    },
  };
}

export function fakeServices(persistedStates: StoreSchema["addons"]["states"] = {}, appVersion = "2026.811.0") {
  const stored: Pick<StoreSchema, "addons"> = { addons: { states: persistedStates, settings: {} } };
  const storeListeners: ((newValue?: StoreSchema["addons"], oldValue?: StoreSchema["addons"]) => void)[] = [];
  const memory = new Map<string, unknown>();
  const ipcHandlers = new Map<string, (event: AddonIpcInvokeEvent, ...args: unknown[]) => unknown>();
  const ipcListeners = new Map<string, (event: AddonIpcEvent, ...args: unknown[]) => void>();
  const registeredScripts = new Map<string, Map<string, string>>();
  const windows: ReturnType<typeof fakeWindow>[] = [];
  const playerEvents = new EventEmitter();
  let isAppSender = true;

  function fakeWindow(id: number) {
    let isDestroyed = false;
    const closedCallbacks: (() => void)[] = [];
    const window = {
      show: vi.fn(),
      focus: vi.fn(),
      close: vi.fn(() => {
        isDestroyed = true;
        for (const callback of closedCallbacks) callback();
      }),
      isDestroyed: () => isDestroyed,
      once: (_event, callback) => {
        closedCallbacks.push(callback);
      },
      webContents: { ...fakeAddonContents(id), isDestroyed: () => isDestroyed },
    } satisfies AddonHostWindow;
    return window;
  }

  const services = {
    store: {
      get: (key: "addons") => structuredClone(stored[key]),
      set: (key: "addons", value: StoreSchema["addons"]) => {
        const old = structuredClone(stored[key]);
        stored[key] = structuredClone(value);
        for (const listener of storeListeners) listener(stored[key], old);
      },
      onDidChange: (_key: "addons", listener: (newValue?: StoreSchema["addons"], oldValue?: StoreSchema["addons"]) => void) => {
        storeListeners.push(listener);
        return () => {
          storeListeners.splice(storeListeners.indexOf(listener), 1);
        };
      },
      get store() {
        return structuredClone(stored);
      },
    },
    memoryStore: {
      get: (key: string) => memory.get(key),
      set: (key: string, value: unknown) => memory.set(key, value),
    },
    appVersion,
    userDataPath: makeTempDir("ytmd-addon-test-"),
    getYtmView: (): ReturnType<AddonHostServices["getYtmView"]> => null,
    registerYtmScript: (namespace: string, name: string, script: string) => {
      let scripts = registeredScripts.get(namespace);
      if (scripts === undefined) {
        scripts = new Map<string, string>();
        registeredScripts.set(namespace, scripts);
      }
      scripts.set(name, script);
    },
    invokeYtmScript: vi.fn(() => Promise.resolve(undefined)),
    player: {
      getState: () => makePlayerState(),
      getQueue: () => null,
      getPlaylistId: () => null,
      addEventListener: vi.fn<AddonHostServices["player"]["addEventListener"]>(),
      removeEventListener: vi.fn<AddonHostServices["player"]["removeEventListener"]>(),
      events: {
        on: (event, listener) => {
          playerEvents.on(event, listener);
        },
        off: (event, listener) => {
          playerEvents.off(event, listener);
        },
      },
    },
    playback: {
      cueTrack: vi.fn((): Promise<CueResult> => Promise.resolve("no-view")),
      sendPlaybackCommand: vi.fn(() => true),
      getPlaylists: vi.fn(() => Promise.resolve([])),
    },
    ipc: {
      handle: (channel: string, listener: (event: AddonIpcInvokeEvent, ...args: unknown[]) => unknown) => {
        ipcHandlers.set(channel, listener);
      },
      removeHandler: (channel: string) => {
        ipcHandlers.delete(channel);
      },
      on: (channel: string, listener: (event: AddonIpcEvent, ...args: unknown[]) => void) => {
        ipcListeners.set(channel, listener);
      },
      removeListener: (channel: string) => {
        ipcListeners.delete(channel);
      },
    },
    isAppSender: () => isAppSender,
    notify: vi.fn(),
    refreshTrayMenu: vi.fn(),
    createWindow: vi.fn<(options: Parameters<AddonHostServices["createWindow"]>[0]) => ReturnType<typeof fakeWindow>>(() => {
      const window = fakeWindow(windows.length + 1);
      windows.push(window);
      return window;
    }),
    discord: {
      isEnabled: vi.fn(() => false),
      onEnabledChanged: vi.fn(() => () => {
        return undefined;
      }),
      registerButtonsProvider: vi.fn(() => () => {
        return undefined;
      }),
      registerRemoteActivityProvider: vi.fn<AddonHostServices["discord"]["registerRemoteActivityProvider"]>(() => () => {
        return undefined;
      }),
      refreshActivity: vi.fn(),
    },
    deepLinks: {
      register: vi.fn(() => () => {
        return undefined;
      }),
    },
    theme: {
      get: vi.fn<AddonHostServices["theme"]["get"]>(() => ({ id: null, name: "None", tokens: {} })),
      subscribe: vi.fn<AddonHostServices["theme"]["subscribe"]>(() => () => {
        return undefined;
      }),
    },
  } satisfies AddonHostServices;

  return {
    services,
    stored,
    memory,
    ipcHandlers,
    ipcListeners,
    registeredScripts,
    windows,
    playerEvents,
    setAppSender: (isValue: boolean) => {
      isAppSender = isValue;
    },
  };
}
