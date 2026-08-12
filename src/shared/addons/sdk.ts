/** The complete surface an addon can program against.
 *
 *  This file stands alone with no imports so it can be emitted as a single
 *  declaration file (ytmd-addon.d.ts) for addon authors. The app compiles
 *  against these same declarations, so the published types cannot drift from
 *  what the runtime hands over. */

export type Unsubscribe = () => void;

/** What activate() may return; destroy() runs when the app shuts the addon down. */
export interface AddonInstance {
  destroy?(): void | Promise<void>;
}

/** The shape of an addon's main entry point. */
export type AddonActivate = (ctx: AddonContext) => AddonInstance | void | Promise<AddonInstance | void>;

// ---------------------------------------------------------------------------
// Manifest and runtime descriptors
// ---------------------------------------------------------------------------

export type AddonManifest = {
  /** Folder name for external addons; ^[a-z0-9][a-z0-9-]{1,63}$ */
  id: string;
  name: string;
  /** semver */
  version: string;
  author: string;
  description: string;
  /** Oldest app version the addon works with; incompatible addons are listed but never loaded */
  minAppVersion?: string;
  /** Homepage or repository shown on the addon card; http(s) only */
  homepage?: string;
  /** Addon API generation this addon targets. Additive context growth never
   *  bumps it; a too-new addon is listed as incompatible. Current: 1 */
  apiVersion?: number;
  /** Relative path to a CommonJS entry. Optional: pure style/script addons need none */
  main?: string;
  /** CSS files injected into the YouTube Music view, watched for edits */
  styles?: string[];
  /** Script files injected into the YouTube Music view; each must evaluate to a callable */
  ytmScripts?: string[];
  /** Bundled addons only; external addons always start disabled */
  defaultEnabled?: boolean;
};

export type AddonOrigin = "bundled" | "external";

/** What actually happened to the addon this boot, as opposed to the persisted intent */
export type AddonRuntimeState = "active" | "disabled" | "error" | "incompatible";

export type AddonSettingsField =
  | { key: string; type: "toggle"; label: string; description?: string }
  | { key: string; type: "text"; label: string; description?: string; placeholder?: string; maxlength?: number }
  | { key: string; type: "number"; label: string; description?: string; min?: number; max?: number; step?: number; display?: "slider" | "input" }
  | { key: string; type: "select"; label: string; description?: string; options: { label: string; value: string | number }[] }
  /** A clickable row with no stored value; clicks reach settings.onAction(key) */
  | { key: string; type: "button"; label: string; buttonText: string; description?: string };

export const ADDON_SETTINGS_FIELD_TYPES = ["toggle", "text", "number", "select", "button"] as const satisfies readonly AddonSettingsField["type"][];

export type AddonSettingsSection = {
  title?: string;
  fields: AddonSettingsField[];
};

export type AddonTrayMenuItem = {
  label: string;
  enabled?: boolean;
  click(): void;
};

export type AddonTitlebarBadge = {
  addonId: string;
  /** Material Symbols ligature name, like "headphones" */
  icon: string;
  text?: string;
  tooltip?: string;
  active?: boolean;
};

export type AddonDescriptor = {
  manifest: AddonManifest;
  origin: AddonOrigin;
  /** Persisted intent; takes effect on the next launch when it disagrees with state */
  enabled: boolean;
  state: AddonRuntimeState;
  error?: string;
  /** Most recent runtime error from one of the addon's callbacks; the addon stays active */
  lastError?: string;
  restartRequired: boolean;
  settingsSections: AddonSettingsSection[];
};

// ---------------------------------------------------------------------------
// Player state
// ---------------------------------------------------------------------------

export enum VideoState {
  Unknown = -1,
  Paused = 0,
  Playing = 1,
  Buffering = 2
}

export enum RepeatMode {
  Unknown = -1,
  None = 0,
  All = 1,
  One = 2
}

export enum LikeStatus {
  Unknown = -1,
  Dislike = 0,
  Indifferent = 1,
  Like = 2
}

export enum VideoType {
  Unknown = -1,
  MusicAudio = 0,
  MusicVideo = 1,
  MusicUploaded = 2,
  PodcastEpisode = 3
}

export type Thumbnail = {
  height: number;
  url: string;
  width: number;
};

export type VideoDetails = {
  /** Null when the track carries no album, like uploads and podcasts */
  album: string | null;
  albumId: string | null;
  author: string;
  channelId: string;
  durationSeconds: number;
  thumbnails: Thumbnail[];
  title: string;
  id: string;
  likeStatus: LikeStatus;
  videoType: VideoType;
  isLive: boolean;
};

export type PlayerQueueItem = {
  thumbnails: Thumbnail[];
  title: string;
  author: string;
  duration: string;
  selected: boolean;
  videoId: string;
  /** Alternate renditions (audio/video counterparts); null when the item has none */
  counterparts: PlayerQueueItem[] | null;
};

export type PlayerQueue = {
  automixItems: PlayerQueueItem[];
  autoplay: boolean;
  isGenerating: boolean;
  isInfinite: boolean;
  items: PlayerQueueItem[];
  repeatMode: RepeatMode;
  selectedItemIndex: number;
};

export type PlayerState = {
  /** Null until the first track loads */
  videoDetails: VideoDetails | null;
  playlistId: string | null;
  trackState: VideoState;
  queue: PlayerQueue | null;
  videoProgress: number;
  volume: number;
  muted: boolean;
  adPlaying: boolean;
  hasFullMetadata: boolean;
};

/** Granular changes derived centrally from the player snapshot stream. */
export type PlayerEventMap = {
  /** A different video became current, or the track cleared */
  trackChanged: { current: VideoDetails | null; previous: VideoDetails | null; playlistId: string | null };
  playStateChanged: { playing: boolean; trackState: VideoState };
  volumeChanged: { volume: number; muted: boolean };
  /** The position jumped instead of progressing naturally */
  seeked: { fromSeconds: number; toSeconds: number };
  adStateChanged: { adPlaying: boolean };
  /** Queue contents, selection or repeat mode changed */
  queueChanged: { queue: PlayerQueue | null };
  /** Like status flipped on the current track */
  likeChanged: { likeStatus: LikeStatus; videoId: string | null };
  repeatModeChanged: { repeatMode: RepeatMode };
};

export type PlayerEventName = keyof PlayerEventMap;

// ---------------------------------------------------------------------------
// Playback control
// ---------------------------------------------------------------------------

/** Repeat mode as the page names it. */
export type YTMRepeatMode = "NONE" | "ALL" | "ONE";

/** The complete remote-control vocabulary the player page understands. */
export type RemoteCommand =
  | { command: "playPause" }
  | { command: "play" }
  | { command: "pause" }
  | { command: "next" }
  | { command: "previous" }
  | { command: "toggleLike" }
  | { command: "toggleDislike" }
  | { command: "volumeUp" }
  | { command: "volumeDown" }
  | { command: "setVolume"; value: number }
  | { command: "mute" }
  | { command: "unmute" }
  | { command: "repeatMode"; value: YTMRepeatMode }
  | { command: "seekTo"; value: number }
  | { command: "shuffle" }
  | { command: "playQueueIndex"; value: number }
  | { command: "navigate"; value: { watchEndpoint: { videoId?: string; playlistId?: string } } };

export type RemoteCommandName = RemoteCommand["command"];

/** Where to land inside a track: an absolute position, or a shared moment in
 *  time everyone seeks relative to. */
export type PositionAnchor = { kind: "absolute"; seconds: number } | { kind: "anchor"; epochMs: number };

export type CueRequest = {
  videoId: string;
  playlistId?: string | null;
  anchor: PositionAnchor | null;
};

export type CueResult = "seeked" | "navigated" | "already-there" | "timeout" | "superseded" | "no-view";

// ---------------------------------------------------------------------------
// Discord presence
// ---------------------------------------------------------------------------

export type RemoteTrackActivity = {
  title: string;
  author: string;
  thumbnailUrl?: string;
  videoId?: string;
  startedAtEpochMs?: number;
  smallText?: string;
};

// ---------------------------------------------------------------------------
// Runtime objects handed to the addon
// ---------------------------------------------------------------------------

/** Scoped logger writing into the app log under [addon:<id>]. Mirrors
 *  electron-log's level methods. */
export interface AddonLogger {
  error(...params: unknown[]): void;
  warn(...params: unknown[]): void;
  info(...params: unknown[]): void;
  verbose(...params: unknown[]): void;
  debug(...params: unknown[]): void;
  silly(...params: unknown[]): void;
  log(...params: unknown[]): void;
}

/** Structural view of the web contents behind a window or the music view. */
export interface AddonWebContents {
  readonly id: number;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
}

export interface AddonIpcInvokeEvent {
  sender: AddonWebContents;
}

export interface AddonIpcEvent {
  sender: AddonWebContents;
  reply(channel: string, ...args: unknown[]): void;
}

/** One injected stylesheet in the YouTube Music view. Survives view reloads;
 *  file-backed handles follow edits on disk. */
export interface AddonCssHandle {
  update(css: string): Promise<void>;
  remove(): Promise<void>;
}

/** Exactly one of entry or file. Windows are frameless: HTML loaded via file
 *  supplies its own drag region (-webkit-app-region: drag) and close control
 *  (window.ytmdAddon.closeWindow()). */
export type AddonWindowOptions = {
  /** Name of a renderer window folder compiled into the app (like "room"); bundled addons only */
  entry?: string;
  /** HTML file relative to the addon's folder, loaded with the ytmdAddon preload bridge */
  file?: string;
  width: number;
  height: number;
  resizable?: boolean;
  title?: string;
};

export type AddonWindowHandle = {
  show(): void;
  close(): void;
  isOpen(): boolean;
  webContents(): AddonWebContents | null;
  /** Sends on the addon's namespaced channel: addon:<id>:<channel> */
  send(channel: string, ...args: unknown[]): void;
};

/** What the ytmdAddon preload bridge exposes inside an addon's own window.
 *  Channels are namespaced automatically; window.ytmdAddon.invoke("ping")
 *  reaches ctx.ipc.handle("ping", ...). */
export interface AddonWindowBridge {
  readonly addonId: string;
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (...args: unknown[]) => void): Unsubscribe;
  settings: {
    getAll(): Promise<Record<string, unknown>>;
    onChanged(callback: (settings: Record<string, unknown>) => void): Unsubscribe;
  };
  memory: {
    getAll(): Promise<Record<string, unknown>>;
    onChanged(callback: (memory: Record<string, unknown>) => void): Unsubscribe;
  };
  closeWindow(): void;
}

// ---------------------------------------------------------------------------
// The context
// ---------------------------------------------------------------------------

export interface AddonContext {
  readonly manifest: AddonManifest;
  readonly log: AddonLogger;
  /** data: a per-addon folder for anything the addon wants to persist itself */
  readonly paths: { data: string };
  readonly app: { version: string };
  settings: {
    /** Fills missing keys only; never clobbers what the user already set */
    registerDefaults(defaults: Record<string, unknown>): void;
    get<T = unknown>(key: string): T;
    set(key: string, value: unknown): void;
    onDidChange(key: string, callback: (next: unknown, prev: unknown) => void): Unsubscribe;
    /** Replaces the addon's settings UI; call once with everything to show */
    registerSettingsUI(sections: AddonSettingsSection[]): void;
    /** Fires when the user clicks a button field with this key */
    onAction(key: string, callback: () => void): Unsubscribe;
  };
  /** Volatile per-addon state, gone on quit */
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
    /** Delivery for messages page scripts post through
     *  window.ytmd.postAddonMessage(addonId, name, payload). */
    onMessage(name: string, callback: (payload: unknown) => void): Unsubscribe;
    insertCSS(css: string): AddonCssHandle;
    watchCSSFile(filePath: string): AddonCssHandle;
  };
  player: {
    getState(): PlayerState;
    getQueue(): PlayerQueue | null;
    getPlaylistId(): string | null;
    /** The full snapshot stream; prefer on(event, ...) to react to one kind of change */
    onStateChanged(callback: (state: PlayerState) => void): Unsubscribe;
    /** Granular, centrally derived events with typed payloads */
    on<K extends PlayerEventName>(event: K, callback: (payload: PlayerEventMap[K]) => void): Unsubscribe;
  };
  /** Every method returns false when the player page is not available. */
  playback: {
    play(): boolean;
    pause(): boolean;
    playPause(): boolean;
    next(): boolean;
    previous(): boolean;
    toggleLike(): boolean;
    toggleDislike(): boolean;
    /** 0 to 100; anything else throws */
    setVolume(volume: number): boolean;
    volumeUp(): boolean;
    volumeDown(): boolean;
    mute(): boolean;
    unmute(): boolean;
    /** Absolute position in seconds */
    seekTo(seconds: number): boolean;
    setRepeatMode(mode: YTMRepeatMode): boolean;
    shuffle(): boolean;
    /** Index into ctx.player.getQueue(): items first, then automix items */
    playQueueIndex(index: number): boolean;
    /** Opens a track and lands at the requested position, retrying seeks until
     *  the page settles. */
    cueTrack(request: CueRequest): Promise<CueResult>;
    /** The low-level escape hatch behind the named methods; throws on a
     *  malformed value. */
    sendPlaybackCommand(command: RemoteCommandName, value?: unknown): boolean;
    /** The signed-in account's playlists, fetched live from the page. */
    getPlaylists(): Promise<{ id: string; title: string }[]>;
  };
  /** InnerTube (music.youtube.com/youtubei/v1) with the page's own signed-in
   *  session. Unofficial API: response shapes can change at any time. Common
   *  endpoints: "browse", "player", "search", "next". Requires a signed-in
   *  page; rides the page-script pipeline with its 30s timeout. */
  innertube: {
    request<T = unknown>(endpoint: string, body?: Record<string, unknown>): Promise<T>;
  };
  /** Channels are namespaced per addon: a renderer reaches this addon at
   *  addon:<id>:<channel>. */
  ipc: {
    handle(channel: string, listener: (event: AddonIpcInvokeEvent, ...args: unknown[]) => unknown): Unsubscribe;
    on(channel: string, listener: (event: AddonIpcEvent, ...args: unknown[]) => void): Unsubscribe;
  };
  notifications: {
    show(options: { title: string; body?: string; onClick?: () => void }): void;
  };
  windows: {
    create(options: AddonWindowOptions): AddonWindowHandle;
  };
  deepLinks: {
    /** Handles ytmdplus://<command>/... links; "play" is reserved by the app */
    register(command: string, handler: (segments: string[], params: URLSearchParams) => void): Unsubscribe;
  };
  discord: {
    /** Whether the user has Discord presence turned on in Settings */
    isEnabled(): boolean;
    onEnabledChanged(callback: (enabled: boolean) => void): Unsubscribe;
    /** Discord shows at most two buttons across all providers */
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
  tray: {
    /** Replaces this addon's tray menu section; an empty list removes it */
    setMenuItems(items: AddonTrayMenuItem[]): void;
  };
}
