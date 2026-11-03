export type Unsubscribe = () => void;

export type AddonInstance = {
  destroy?: (() => void) | (() => Promise<void>);
};

export type AddonActivate =
  ((ctx: AddonContext) => AddonInstance | Promise<AddonInstance>) | ((ctx: AddonContext) => void) | ((ctx: AddonContext) => Promise<void>);

export type AddonManifest = {
  id: string;
  name: string;

  version: string;
  author: string;
  description: string;

  minAppVersion?: string;

  homepage?: string;

  apiVersion?: number;

  main?: string;

  styles?: string[];

  ytmScripts?: string[];

  defaultEnabled?: boolean;
};

export type AddonThemeTokens = Record<string, string>;

export type AddonActiveTheme = {
  id: string | null;
  name: string;
  tokens: AddonThemeTokens;
};

export type AddonOrigin = "bundled" | "external";

export type AddonRuntimeState = "active" | "disabled" | "error" | "incompatible";

export type AddonSettingsField =
  | { key: string; type: "toggle"; label: string; description?: string }
  | { key: string; type: "text"; label: string; description?: string; placeholder?: string; maxlength?: number }
  | { key: string; type: "number"; label: string; description?: string; min?: number; max?: number; step?: number; display?: "slider" | "input" }
  | { key: string; type: "select"; label: string; description?: string; options: { label: string; value: string | number }[] }
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

  icon: string;
  text?: string;
  tooltip?: string;
  active?: boolean;
};

export type AddonDescriptor = {
  manifest: AddonManifest;
  origin: AddonOrigin;

  enabled: boolean;
  state: AddonRuntimeState;
  error?: string;

  lastError?: string;
  warnings?: string[];
  restartRequired: boolean;
  settingsSections: AddonSettingsSection[];
};

export const VideoState = {
  Unknown: -1,
  [-1]: "Unknown",
  Paused: 0,
  [0]: "Paused",
  Playing: 1,
  [1]: "Playing",
  Buffering: 2,
  [2]: "Buffering",
} as const;
export type VideoState = (typeof VideoState)[Exclude<keyof typeof VideoState, number>];

export const RepeatMode = {
  Unknown: -1,
  [-1]: "Unknown",
  None: 0,
  [0]: "None",
  All: 1,
  [1]: "All",
  One: 2,
  [2]: "One",
} as const;
export type RepeatMode = (typeof RepeatMode)[Exclude<keyof typeof RepeatMode, number>];

export const LikeStatus = {
  Unknown: -1,
  [-1]: "Unknown",
  Dislike: 0,
  [0]: "Dislike",
  Indifferent: 1,
  [1]: "Indifferent",
  Like: 2,
  [2]: "Like",
} as const;
export type LikeStatus = (typeof LikeStatus)[Exclude<keyof typeof LikeStatus, number>];

export const VideoType = {
  Unknown: -1,
  [-1]: "Unknown",
  MusicAudio: 0,
  [0]: "MusicAudio",
  MusicVideo: 1,
  [1]: "MusicVideo",
  MusicUploaded: 2,
  [2]: "MusicUploaded",
  PodcastEpisode: 3,
  [3]: "PodcastEpisode",
} as const;
export type VideoType = (typeof VideoType)[Exclude<keyof typeof VideoType, number>];

export type Thumbnail = {
  height: number;
  url: string;
  width: number;
};

export type VideoDetails = {
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

  counterparts: PlayerQueueItem[] | null;
};

export type PlayerQueue = {
  automixItems: (PlayerQueueItem | null)[];
  autoplay: boolean;
  isGenerating: boolean;
  isInfinite: boolean;
  items: (PlayerQueueItem | null)[];
  repeatMode: RepeatMode;
  selectedItemIndex: number;
};

export type PlayerState = {
  videoDetails: VideoDetails | null;
  playlistId: string | null | undefined;
  trackState: VideoState;
  queue: PlayerQueue | null;
  videoProgress: number;
  volume: number;
  muted: boolean;
  adPlaying: boolean;
  hasFullMetadata: boolean;
};

export type PlayerEventMap = {
  trackChanged: { current: VideoDetails | null; previous: VideoDetails | null; playlistId: string | null | undefined };
  playStateChanged: { playing: boolean; trackState: VideoState };
  volumeChanged: { volume: number; muted: boolean };

  seeked: { fromSeconds: number; toSeconds: number };
  adStateChanged: { adPlaying: boolean };

  queueChanged: { queue: PlayerQueue | null };

  likeChanged: { likeStatus: LikeStatus; videoId: string | null };
  repeatModeChanged: { repeatMode: RepeatMode };
};

export type PlayerEventName = keyof PlayerEventMap;

export type YTMRepeatMode = "NONE" | "ALL" | "ONE";

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

export type PositionAnchor = { kind: "absolute"; seconds: number } | { kind: "anchor"; epochMs: number };

export type CueRequest = {
  videoId: string;
  playlistId?: string | null;
  anchor: PositionAnchor | null;
};

export type CueResult = "seeked" | "navigated" | "already-there" | "timeout" | "superseded" | "no-view";

export type RemoteTrackActivity = {
  title: string;
  author: string;
  thumbnailUrl?: string;
  videoId?: string;
  startedAtEpochMs?: number;
  smallText?: string;
};

export type AddonLogger = {
  error(...params: unknown[]): void;
  warn(...params: unknown[]): void;
  info(...params: unknown[]): void;
  verbose(...params: unknown[]): void;
  debug(...params: unknown[]): void;
  silly(...params: unknown[]): void;
  log(...params: unknown[]): void;
};

export type AddonWebContents = {
  readonly id: number;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
};

export type AddonIpcInvokeEvent = {
  sender: AddonWebContents;
};

export type AddonIpcEvent = {
  sender: AddonWebContents;
  reply(channel: string, ...args: unknown[]): void;
};

export type AddonCssHandle = {
  update(css: string): Promise<void>;
  remove(): Promise<void>;
};

export type AddonWindowOptions = {
  entry?: string;

  file?: string;
  width: number;
  height: number;
  resizable?: boolean;
  title?: string;

  show?: boolean;
  themed?: boolean;
};

export type AddonWindowHandle = {
  show(): void;
  close(): void;
  isOpen(): boolean;
  webContents(): AddonWebContents | null;

  send(channel: string, ...args: unknown[]): void;
};

export type AddonWindowBridge = {
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
};

export type AddonContext = {
  readonly manifest: AddonManifest;
  readonly log: AddonLogger;

  readonly paths: { data: string };
  readonly app: { version: string };
  settings: {
    registerDefaults(defaults: Record<string, unknown>): void;
    get(key: string): unknown;
    set(key: string, value: unknown): void;
    onDidChange(key: string, callback: (next: unknown, prev: unknown) => unknown): Unsubscribe;

    registerSettingsUI(sections: AddonSettingsSection[]): void;

    onAction(key: string, callback: () => unknown): Unsubscribe;
  };

  memory: {
    get(key: string): unknown;
    set(key: string, value: unknown): void;
  };
  ytmview: {
    registerScript(name: string, script: string): void;
    runScript(name: string): void;

    invokeScript(name: string, arg?: unknown): Promise<unknown>;
    onLoaded(callback: () => unknown): Unsubscribe;

    onMessage(name: string, callback: (payload: unknown) => unknown): Unsubscribe;
    insertCSS(css: string): AddonCssHandle;
    watchCSSFile(filePath: string): AddonCssHandle;
  };
  player: {
    getState(): PlayerState;
    getQueue(): PlayerQueue | null;
    getPlaylistId(): string | null | undefined;

    onStateChanged(callback: (state: PlayerState) => unknown): Unsubscribe;

    on<K extends PlayerEventName>(event: K, callback: (payload: PlayerEventMap[K]) => unknown): Unsubscribe;
  };

  playback: {
    play(): boolean;
    pause(): boolean;
    playPause(): boolean;
    next(): boolean;
    previous(): boolean;
    toggleLike(): boolean;
    toggleDislike(): boolean;

    setVolume(volume: number): boolean;
    volumeUp(): boolean;
    volumeDown(): boolean;
    mute(): boolean;
    unmute(): boolean;

    seekTo(seconds: number): boolean;
    setRepeatMode(mode: YTMRepeatMode): boolean;
    shuffle(): boolean;

    playQueueIndex(index: number): boolean;

    cueTrack(request: CueRequest): Promise<CueResult>;

    sendPlaybackCommand(command: RemoteCommandName, value?: unknown): boolean;

    getPlaylists(): Promise<{ id: string; title: string }[]>;
  };

  innertube: {
    request(endpoint: string, body?: Record<string, unknown>): Promise<unknown>;
  };

  ipc: {
    handle(channel: string, listener: (event: AddonIpcInvokeEvent, ...args: unknown[]) => unknown): Unsubscribe;
    on(channel: string, listener: (event: AddonIpcEvent, ...args: unknown[]) => unknown): Unsubscribe;
  };
  theme: {
    get(): AddonActiveTheme;
    onChanged(callback: (theme: AddonActiveTheme) => unknown): Unsubscribe;
  };
  notifications: {
    show(options: { title: string; body?: string; onClick?: () => void }): void;
  };
  windows: {
    create(options: AddonWindowOptions): AddonWindowHandle;
  };
  deepLinks: {
    register(command: string, handler: (segments: string[], params: URLSearchParams) => unknown): Unsubscribe;
  };
  discord: {
    isEnabled(): boolean;
    onEnabledChanged(callback: (enabled: boolean) => unknown): Unsubscribe;

    registerButtonsProvider(provider: () => { label: string; url: string }[] | undefined): Unsubscribe;

    registerRemoteActivityProvider(provider: () => RemoteTrackActivity | undefined): Unsubscribe;
    refreshActivity(): void;
  };
  titlebar: {
    setBadge(badge: Omit<AddonTitlebarBadge, "addonId"> | null): void;
    onBadgeClick(callback: () => unknown): Unsubscribe;
  };
  tray: {
    setMenuItems(items: AddonTrayMenuItem[]): void;
  };
};
