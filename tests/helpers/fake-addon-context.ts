import { vi } from "vitest";
import type { AddonContext } from "~shared/addons/sdk";
import {
  VideoState,
  VideoType,
  LikeStatus,
  type AddonCssHandle,
  type AddonIpcEvent,
  type AddonManifest,
  type AddonSettingsSection,
  type AddonTitlebarBadge,
  type AddonTrayMenuItem,
  type AddonWindowHandle,
  type CueResult,
  type PlayerEventMap,
  type PlayerEventName,
  type PlayerState,
  type RemoteTrackActivity,
  type VideoDetails,
} from "../../src/shared/addons/sdk";

export function makeManifest(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: "sample",
    name: "Sample",
    version: "1.0.0",
    author: "someone",
    description: "a sample addon",
    ...overrides,
  };
}

export function makeVideoDetails(overrides: Partial<VideoDetails> = {}): VideoDetails {
  return {
    album: null,
    albumId: null,
    author: "Artist",
    channelId: "chan",
    durationSeconds: 180,
    thumbnails: [],
    title: "Track",
    id: "vid",
    likeStatus: LikeStatus.Indifferent,
    videoType: VideoType.MusicAudio,
    isLive: false,
    ...overrides,
  };
}

export function makePlayerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    videoDetails: null,
    playlistId: null,
    trackState: VideoState.Unknown,
    queue: null,
    videoProgress: 0,
    volume: 50,
    muted: false,
    adPlaying: false,
    hasFullMetadata: false,
    ...overrides,
  };
}

export type FakeAddonContextOptions = {
  manifest?: AddonManifest;

  settings?: Record<string, unknown>;

  discordEnabled?: boolean;

  invokeScript?: (name: string, arg?: unknown) => Promise<unknown>;

  innertube?: (endpoint: string, body?: Record<string, unknown>) => Promise<unknown>;
};

export function fakeAddonContext(options: FakeAddonContextOptions = {}) {
  const manifest = options.manifest ?? makeManifest();
  const settings = new Map<string, unknown>(Object.entries(options.settings ?? {}));
  const unsubscribe = vi.fn();
  const invoke = options.invokeScript ?? (() => Promise.resolve(true));
  const innertube = options.innertube ?? (() => Promise.resolve({}));
  const invocationListeners = new Set<(name: string, arg: unknown) => void>();

  const captured: {
    scripts: Record<string, string>;
    invocations: { name: string; arg: unknown }[];
    loadedCallbacks: (() => unknown)[];
    messageCallbacks: Record<string, ((payload: unknown) => void)[]>;
    stateListeners: ((state: PlayerState) => void)[];
    eventListeners: Record<string, ((payload: unknown) => void)[]>;
    settingsListeners: Record<string, (next?: unknown, prev?: unknown) => unknown>;
    actionCallbacks: Record<string, () => void>;
    sections: AddonSettingsSection[];
    remoteProviders: (() => RemoteTrackActivity | undefined)[];
    buttonsProviders: (() => { label: string; url: string }[] | undefined)[];
    badges: (Omit<AddonTitlebarBadge, "addonId"> | null)[];
    deepLinks: Record<string, (segments: string[], params: URLSearchParams) => void>;
    innertubeCalls: { endpoint: string; body?: Record<string, unknown> }[];
    trayItems: AddonTrayMenuItem[];
    windows: AddonWindowHandle[];
    ipcHandlers: Record<string, (event: AddonIpcEvent, ...args: unknown[]) => void>;
    notificationsShown: { title: string; body?: string }[];
    cssRemoved: number;
  } = {
    scripts: {},
    invocations: [],
    loadedCallbacks: [],
    messageCallbacks: {},
    stateListeners: [],
    eventListeners: {},
    settingsListeners: {},
    actionCallbacks: {},
    sections: [],
    remoteProviders: [],
    buttonsProviders: [],
    badges: [],
    deepLinks: {},
    innertubeCalls: [],
    trayItems: [],
    windows: [],
    ipcHandlers: {},
    notificationsShown: [],
    cssRemoved: 0,
  };

  const memoryBag = new Map<string, unknown>();

  function cssHandle() {
    return {
      update: vi.fn(() => Promise.resolve(undefined)),
      remove: vi.fn(() => {
        captured.cssRemoved++;
        return Promise.resolve(undefined);
      }),
    } satisfies AddonCssHandle;
  }

  function windowHandle() {
    let isOpen = true;
    return {
      show: vi.fn(),
      close: vi.fn(() => {
        isOpen = false;
      }),
      isOpen: () => isOpen,
      webContents: () => null,
      send: vi.fn(),
    } satisfies AddonWindowHandle;
  }

  const ctx = {
    manifest,
    log: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      verbose: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn(),
      log: vi.fn(),
    },
    paths: { data: "" },
    app: { version: "0.0.0" },
    settings: {
      registerDefaults: vi.fn((defaults: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(defaults)) {
          if (settings.get(key) === undefined) settings.set(key, value);
        }
      }),
      get: (key) => settings.get(key),
      set: vi.fn((key: string, value: unknown) => {
        settings.set(key, value);
      }),
      onDidChange: vi.fn((key: string, callback: (next: unknown, prev: unknown) => void) => {
        captured.settingsListeners[key] = callback;
        return unsubscribe;
      }),
      registerSettingsUI: vi.fn((sections: AddonSettingsSection[]) => {
        captured.sections = sections;
      }),
      onAction: vi.fn((key: string, callback: () => void) => {
        captured.actionCallbacks[key] = callback;
        return unsubscribe;
      }),
    },
    memory: {
      get: (key) => memoryBag.get(key),
      set: vi.fn((key: string, value: unknown) => {
        memoryBag.set(key, value);
      }),
    },
    ytmview: {
      registerScript: vi.fn((name: string, script: string) => {
        captured.scripts[name] = script;
      }),
      runScript: vi.fn(),
      invokeScript: vi.fn((name: string, arg?: unknown) => {
        captured.invocations.push({ name, arg });
        for (const listener of invocationListeners) listener(name, arg);
        return invoke(name, arg);
      }),
      onLoaded: vi.fn((callback: () => unknown) => {
        captured.loadedCallbacks.push(callback);
        return unsubscribe;
      }),
      onMessage: vi.fn((name: string, callback: (payload: unknown) => void) => {
        (captured.messageCallbacks[name] ??= []).push(callback);
        return unsubscribe;
      }),
      insertCSS: vi.fn(() => cssHandle()),
      watchCSSFile: vi.fn(() => cssHandle()),
    },
    player: {
      getState: vi.fn(() => makePlayerState()),
      getQueue: vi.fn<AddonContext["player"]["getQueue"]>(() => null),
      getPlaylistId: vi.fn(() => null),
      onStateChanged: vi.fn((callback: (state: PlayerState) => void) => {
        captured.stateListeners.push(callback);
        return unsubscribe;
      }),
      on: vi.fn((event: PlayerEventName, callback: (payload: unknown) => void) => {
        (captured.eventListeners[event] ??= []).push(callback);
        return unsubscribe;
      }) as AddonContext["player"]["on"],
    },
    playback: {
      play: vi.fn(() => true),
      pause: vi.fn(() => true),
      playPause: vi.fn(() => true),
      next: vi.fn(() => true),
      previous: vi.fn(() => true),
      toggleLike: vi.fn(() => true),
      toggleDislike: vi.fn(() => true),
      setVolume: vi.fn(() => true),
      volumeUp: vi.fn(() => true),
      volumeDown: vi.fn(() => true),
      mute: vi.fn(() => true),
      unmute: vi.fn(() => true),
      seekTo: vi.fn(() => true),
      setRepeatMode: vi.fn(() => true),
      shuffle: vi.fn(() => true),
      playQueueIndex: vi.fn(() => true),
      cueTrack: vi.fn((): Promise<CueResult> => Promise.resolve("no-view")),
      sendPlaybackCommand: vi.fn(() => true),
      getPlaylists: vi.fn(() => Promise.resolve([])),
    },
    ipc: {
      handle: vi.fn(() => unsubscribe),
      on: vi.fn((channel: string, listener: (event: AddonIpcEvent, ...args: unknown[]) => void) => {
        captured.ipcHandlers[channel] = listener;
        return unsubscribe;
      }),
    },
    innertube: {
      request: vi.fn((endpoint: string, body?: Record<string, unknown>) => {
        captured.innertubeCalls.push({ endpoint, body });
        return innertube(endpoint, body);
      }),
    },

    notifications: {
      show: vi.fn((options: { title: string; body?: string }) => {
        captured.notificationsShown.push(options);
      }),
    },
    windows: {
      create: vi.fn(() => {
        const handle = windowHandle();
        captured.windows.push(handle);
        return handle;
      }),
    },
    deepLinks: {
      register: vi.fn((command: string, handler: (segments: string[], params: URLSearchParams) => void) => {
        captured.deepLinks[command] = handler;
        return unsubscribe;
      }),
    },
    theme: {
      get: vi.fn(() => ({ id: null, name: "None", tokens: {} })),
      onChanged: vi.fn(() => unsubscribe),
    },
    discord: {
      isEnabled: vi.fn(() => options.discordEnabled ?? false),
      onEnabledChanged: vi.fn(() => unsubscribe),
      registerButtonsProvider: vi.fn((provider: () => { label: string; url: string }[] | undefined) => {
        captured.buttonsProviders.push(provider);
        return unsubscribe;
      }),
      registerRemoteActivityProvider: vi.fn((provider: () => RemoteTrackActivity | undefined) => {
        captured.remoteProviders.push(provider);
        return unsubscribe;
      }),
      refreshActivity: vi.fn(),
    },
    titlebar: {
      setBadge: vi.fn((badge: Omit<AddonTitlebarBadge, "addonId"> | null) => {
        captured.badges.push(badge);
      }),
      onBadgeClick: vi.fn(() => unsubscribe),
    },
    tray: {
      setMenuItems: vi.fn((items: AddonTrayMenuItem[]) => {
        captured.trayItems = items;
      }),
    },
  } satisfies AddonContext;

  return {
    ctx,
    captured,
    settings,
    unsubscribe,
    waitForInvocation(name: string, matches: (arg: unknown) => boolean) {
      const existing = captured.invocations.find((call) => call.name === name && matches(call.arg));
      if (existing) return Promise.resolve(existing.arg);
      return new Promise<unknown>((resolve) => {
        const listener = (called: string, arg: unknown) => {
          if (called !== name || !matches(arg)) return;
          invocationListeners.delete(listener);
          resolve(arg);
        };
        invocationListeners.add(listener);
      });
    },
    fireLoaded: () => {
      for (const callback of captured.loadedCallbacks) callback();
    },
    emitPlayerState: (state: PlayerState) => {
      for (const listener of captured.stateListeners) listener(state);
    },
    emitPlayerEvent: <K extends PlayerEventName>(event: K, payload: PlayerEventMap[K]) => {
      for (const listener of captured.eventListeners[event] ?? []) listener(payload);
    },
    emitViewMessage: (name: string, payload: unknown) => {
      for (const listener of captured.messageCallbacks[name] ?? []) listener(payload);
    },
  };
}
