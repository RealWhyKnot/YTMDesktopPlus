import { vi } from "vitest";
import type { BundledAddonContext } from "../../src/main/addons/context";
import {
  VideoState,
  VideoType,
  LikeStatus,
  type AddonCssHandle,
  type AddonManifest,
  type AddonSettingsSection,
  type AddonTitlebarBadge,
  type AddonWindowHandle,
  type CueResult,
  type PlayerState,
  type RemoteTrackActivity,
  type VideoDetails
} from "../../src/shared/addons/sdk";

export function makeManifest(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: "sample",
    name: "Sample",
    version: "1.0.0",
    author: "someone",
    description: "a sample addon",
    ...overrides
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
    ...overrides
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
    ...overrides
  };
}

export type FakeAddonContextOptions = {
  manifest?: AddonManifest;
  /** Initial addon settings served by ctx.settings.get */
  settings?: Record<string, unknown>;
  /** Dotted core settings served by ctx.coreSettings.get; missing keys read false */
  coreSettings?: Record<string, unknown>;
  /** Resolves invokeScript calls; defaults to resolving true */
  invokeScript?: (name: string, arg?: unknown) => Promise<unknown>;
};

/** A complete, compiler-checked context double. The object literal is typed
 *  against the real interface with no whole-object cast, so a new context
 *  member breaks this file instead of silently drifting past the fakes. */
export function fakeAddonContext(options: FakeAddonContextOptions = {}) {
  const manifest = options.manifest ?? makeManifest();
  const settings: Record<string, unknown> = { ...options.settings };
  const unsubscribe = vi.fn();
  const invoke = options.invokeScript ?? (async () => true);

  const captured = {
    scripts: {} as Record<string, string>,
    invocations: [] as { name: string; arg: unknown }[],
    loadedCallbacks: [] as (() => void)[],
    stateListeners: [] as ((state: PlayerState) => void)[],
    settingsListeners: {} as Record<string, (next?: unknown, prev?: unknown) => void>,
    sections: [] as AddonSettingsSection[],
    remoteProviders: [] as (() => RemoteTrackActivity | undefined)[],
    buttonsProviders: [] as ((trackShareUrl: string) => { label: string; url: string }[] | undefined)[],
    badges: [] as (Omit<AddonTitlebarBadge, "addonId"> | null)[],
    deepLinks: {} as Record<string, (segments: string[], params: URLSearchParams) => void>,
    windows: [] as AddonWindowHandle[],
    notificationsShown: [] as { title: string; body?: string }[],
    cssRemoved: 0
  };

  const memoryBag: Record<string, unknown> = {};
  const coreMemoryBag: Record<string, unknown> = {};

  function cssHandle(): AddonCssHandle {
    return {
      update: vi.fn(async () => {}),
      remove: vi.fn(async () => {
        captured.cssRemoved++;
      })
    };
  }

  function windowHandle(): AddonWindowHandle {
    let open = true;
    return {
      show: vi.fn(),
      close: vi.fn(() => {
        open = false;
      }),
      isOpen: () => open,
      webContents: () => null
    };
  }

  const ctx: BundledAddonContext = {
    manifest,
    log: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      verbose: vi.fn(),
      debug: vi.fn(),
      silly: vi.fn(),
      log: vi.fn()
    },
    paths: { data: "" },
    app: { version: "0.0.0" },
    settings: {
      registerDefaults: vi.fn((defaults: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(defaults)) {
          if (settings[key] === undefined) settings[key] = value;
        }
      }),
      get: <T>(key: string) => settings[key] as T,
      set: vi.fn((key: string, value: unknown) => {
        settings[key] = value;
      }),
      onDidChange: vi.fn((key: string, callback: (next: unknown, prev: unknown) => void) => {
        captured.settingsListeners[key] = callback;
        return unsubscribe;
      }),
      registerSettingsUI: vi.fn((sections: AddonSettingsSection[]) => {
        captured.sections = sections;
      })
    },
    memory: {
      get: <T>(key: string) => memoryBag[key] as T,
      set: vi.fn((key: string, value: unknown) => {
        memoryBag[key] = value;
      })
    },
    ytmview: {
      registerScript: vi.fn((name: string, script: string) => {
        captured.scripts[name] = script;
      }),
      runScript: vi.fn(),
      invokeScript: vi.fn((name: string, arg?: unknown) => {
        captured.invocations.push({ name, arg });
        return invoke(name, arg);
      }),
      onLoaded: vi.fn((callback: () => void) => {
        captured.loadedCallbacks.push(callback);
        return unsubscribe;
      }),
      insertCSS: vi.fn(() => cssHandle()),
      watchCSSFile: vi.fn(() => cssHandle())
    },
    player: {
      getState: vi.fn(() => makePlayerState()),
      getQueue: vi.fn(() => null),
      getPlaylistId: vi.fn(() => null),
      onStateChanged: vi.fn((callback: (state: PlayerState) => void) => {
        captured.stateListeners.push(callback);
        return unsubscribe;
      })
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
      cueTrack: vi.fn(async (): Promise<CueResult> => "no-view"),
      sendPlaybackCommand: vi.fn(() => true),
      getPlaylists: vi.fn(async () => [])
    },
    ipc: {
      handle: vi.fn(() => unsubscribe),
      on: vi.fn(() => unsubscribe)
    },
    notifications: {
      show: vi.fn((options: { title: string; body?: string }) => {
        captured.notificationsShown.push(options);
      })
    },
    windows: {
      create: vi.fn(() => {
        const handle = windowHandle();
        captured.windows.push(handle);
        return handle;
      })
    },
    deepLinks: {
      register: vi.fn((command: string, handler: (segments: string[], params: URLSearchParams) => void) => {
        captured.deepLinks[command] = handler;
        return unsubscribe;
      })
    },
    discord: {
      registerButtonsProvider: vi.fn((provider: (trackShareUrl: string) => { label: string; url: string }[] | undefined) => {
        captured.buttonsProviders.push(provider);
        return unsubscribe;
      }),
      registerRemoteActivityProvider: vi.fn((provider: () => RemoteTrackActivity | undefined) => {
        captured.remoteProviders.push(provider);
        return unsubscribe;
      }),
      refreshActivity: vi.fn()
    },
    titlebar: {
      setBadge: vi.fn((badge: Omit<AddonTitlebarBadge, "addonId"> | null) => {
        captured.badges.push(badge);
      }),
      onBadgeClick: vi.fn(() => unsubscribe)
    },
    coreSettings: {
      get: <T>(dottedKey: string) => (options.coreSettings?.[dottedKey] ?? false) as T,
      onDidChange: vi.fn(() => unsubscribe)
    },
    coreMemory: {
      get: <T>(key: string) => coreMemoryBag[key] as T,
      set: vi.fn((key: string, value: unknown) => {
        coreMemoryBag[key] = value;
      })
    }
  };

  return {
    ctx,
    captured,
    settings,
    coreMemoryBag,
    unsubscribe,
    fireLoaded() {
      for (const callback of captured.loadedCallbacks) callback();
    },
    emitPlayerState(state: PlayerState) {
      for (const listener of captured.stateListeners) listener(state);
    }
  };
}
