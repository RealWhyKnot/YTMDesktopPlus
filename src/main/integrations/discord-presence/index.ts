import type Conf from "conf";

import { playerStateStore, type PlayerState, type Thumbnail, type VideoDetails, VideoState } from "../../player-state-store";
import type { Integration } from "../integration";
import { MemoryStore } from "../../memory-store";
import { type MemoryStoreSchema, type StoreSchema } from "~shared/store/schema";
import { DiscordClient } from "./minimal-discord-client";
import log from "electron-log";
import { DiscordActivityType } from "./minimal-discord-client/types";

const DISCORD_CLIENT_ID = "1533867163079671849";

export const CONNECTION_RETRY_BASE_MS = 5 * 1000;
export const CONNECTION_RETRY_MAX_MS = 60 * 1000;
export const CONNECTION_FAILED_AFTER_ATTEMPTS = 6;

export function connectionRetryDelay(attempt: number): number {
  return Math.min(CONNECTION_RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1), CONNECTION_RETRY_MAX_MS);
}

export type PresenceButton = { label: string; url: string };
export type PresenceButtonsProvider = () => PresenceButton[] | undefined;

import type { RemoteTrackActivity } from "~shared/addons/sdk";

export type RemoteActivityProvider = () => RemoteTrackActivity | undefined;

type PresenceThumbnail = Pick<Thumbnail, "url"> & { width?: unknown; height?: unknown };

export function getHighestResThumbnail(thumbnails: (PresenceThumbnail | null | undefined)[] | null | undefined): string | undefined {
  const usable = Array.isArray(thumbnails)
    ? thumbnails.filter((thumbnail): thumbnail is PresenceThumbnail => typeof thumbnail?.url === "string" && thumbnail.url.length > 0)
    : [];
  if (usable.length === 0) return undefined;
  const area = (thumbnail: PresenceThumbnail) => (Number(thumbnail.width) || 0) * (Number(thumbnail.height) || 0);
  return usable.reduce((accumulator, current) => (area(current) <= area(accumulator) ? accumulator : current)).url;
}

function getSmallImageKey(state: VideoState | null) {
  switch (state) {
    case VideoState.Playing: {
      return "start";
    }
    case VideoState.Unknown:
    case VideoState.Paused:
    case VideoState.Buffering:
    case null:
    default: {
      return "pause";
    }
  }
}

function getSmallImageText(state: VideoState | null) {
  switch (state) {
    case VideoState.Playing: {
      return "Playing";
    }
    case VideoState.Unknown:
    case VideoState.Paused:
    case VideoState.Buffering:
    case null:
    default: {
      return "Paused";
    }
  }
}

function stringLimit(str: string, limit: number, minimum: number) {
  if (str.length > limit) {
    return str.substring(0, limit - 3).trim() + "...";
  }
  if (str.length < minimum) {
    return str.padEnd(minimum, "\u200B");
  }
  return str;
}

export class DiscordPresence implements Integration {
  private storeValue: Conf<StoreSchema> | undefined;
  private get store(): Conf<StoreSchema> {
    const value = this.storeValue;
    if (value === undefined) throw new Error("Integration store has not been provided");
    return value;
  }
  private set store(value: Conf<StoreSchema>) {
    this.storeValue = value;
  }
  private memoryStoreValue: MemoryStore<MemoryStoreSchema> | undefined;
  private get memoryStore(): MemoryStore<MemoryStoreSchema> {
    const value = this.memoryStoreValue;
    if (value === undefined) throw new Error("Integration memoryStore has not been provided");
    return value;
  }
  private set memoryStore(value: MemoryStore<MemoryStoreSchema>) {
    this.memoryStoreValue = value;
  }

  private discordClient: DiscordClient | null = null;
  private isEnabled = false;
  private isReady = false;
  private activityDebounceTimeout: NodeJS.Timeout | null = null;
  private pauseTimeout: NodeJS.Timeout | null = null;
  private connectionRetryTimeout: NodeJS.Timeout | null = null;
  private stateCallback: ((event: PlayerState) => void) | null = null;

  private videoState: VideoState | null = null;
  private videoDetails: VideoDetails | null = null;
  private progress: number | null = null;

  private connectionRetries = 0;
  private buttonsProviders: PresenceButtonsProvider[] = [];
  private remoteActivityProviders: RemoteActivityProvider[] = [];

  private clearOrRemote() {
    if (this.discordClient === null) throw new Error("Discord client is not connected");
    const remote = this.getRemoteActivity();
    if (!remote) {
      this.discordClient.clearActivity();
      return;
    }
    this.discordClient.setActivity({
      type: DiscordActivityType.Listening,
      status_display_type: 1,
      details: stringLimit(remote.title, 128, 2),
      details_url: remote.videoId ? `https://music.youtube.com/watch?v=${remote.videoId}` : undefined,
      state: stringLimit(remote.author, 128, 2),
      timestamps: remote.startedAtEpochMs ? { start: remote.startedAtEpochMs } : undefined,
      assets: {
        large_image: (remote.thumbnailUrl?.length ?? 300) <= 256 ? remote.thumbnailUrl : "icon",

        small_image: "phone",
        small_text: remote.smallText ?? "Playing on another device",
      },
      instance: false,
    });
    log.debug(`dpresence: remote activity set for ${remote.videoId ?? remote.title}`);
  }

  private getRemoteActivity(): RemoteTrackActivity | undefined {
    for (const provider of this.remoteActivityProviders) {
      try {
        const remote = provider();
        if (remote) return remote;
      } catch (error) {
        log.error("Remote activity provider failed", error);
      }
    }
    return undefined;
  }

  private updateActivity() {
    if (this.activityDebounceTimeout) return;
    this.activityDebounceTimeout = setTimeout(() => {
      this.activityDebounceTimeout = null;
      try {
        this.applyActivity();
      } catch (error) {
        log.error("Discord presence update failed", error);
      }
    }, 1000);
  }

  private applyActivity() {
    if (!this.videoDetails) {
      this.clearOrRemote();
      return;
    }
    const { title, author, album, id, thumbnails, durationSeconds, channelId, albumId } = this.videoDetails;
    const thumbnail = getHighestResThumbnail(thumbnails);
    const isPlaying = this.videoState === VideoState.Playing;
    if (!isPlaying && this.storeValue?.get("integrations").discordPresenceHideOnPause) {
      this.clearOrRemote();
      return;
    }
    const nowMs = Date.now();
    const startEpochMs = nowMs - Number(this.progress) * 1000;
    const buttons = this.buildButtons();
    if (this.discordClient === null) throw new Error("Discord client is not connected");
    this.discordClient.setActivity({
      type: DiscordActivityType.Listening,
      status_display_type: 1,
      details: stringLimit(title, 128, 2),
      details_url: `https://music.youtube.com/watch?v=${id}`,
      state: stringLimit(author, 128, 2),
      state_url: `https://music.youtube.com/channel/${channelId}`,
      timestamps: {
        start: isPlaying ? startEpochMs : undefined,
        end: isPlaying ? nowMs + (durationSeconds - Number(this.progress)) * 1000 : undefined,
      },
      assets: {
        large_image: thumbnail && thumbnail.length <= 256 ? thumbnail : "icon",
        large_text: album ? stringLimit(album, 128, 2) : undefined,
        large_url: albumId ? `https://music.youtube.com/browse/${albumId}` : undefined,
        small_image: getSmallImageKey(this.videoState),
        small_text: getSmallImageText(this.videoState),
      },
      instance: false,
      buttons,
    });
    log.debug(`dpresence: activity set for ${id}, ${isPlaying ? "playing" : "paused"}, ${buttons?.length ?? 0} buttons`);
  }

  private playerStateChanged(state: PlayerState) {
    if (!this.isReady) return;

    const { videoDetails, videoProgress, trackState, hasFullMetadata } = state;
    if (!videoDetails) {
      this.videoDetails = null;
      this.videoState = null;
      this.progress = null;
      this.clearOrRemote();
      return;
    }
    const oldState = this.videoState ?? null;
    const oldId = this.videoDetails?.id ?? null;
    const oldProgress = this.progress ?? null;
    this.videoState = trackState;
    this.videoDetails = videoDetails;
    this.progress = Math.floor(videoProgress);
    if (
      hasFullMetadata &&
      (oldState !== this.videoState ||
        oldId !== this.videoDetails.id ||
        Math.abs(this.progress - Number(oldProgress)) > 1 ||
        Number(oldProgress) > this.progress)
    ) {
      this.updateActivity();
    }

    if (this.pauseTimeout !== null) clearTimeout(this.pauseTimeout);
    this.pauseTimeout = null;
    if (state.trackState === VideoState.Playing) return;
    this.pauseTimeout = setTimeout(() => {
      this.pauseTimeout = null;
      if (!this.discordClient || !this.isReady) return;
      try {
        this.clearOrRemote();
      } catch (error) {
        log.error("Discord presence clear failed", error);
      }
    }, 30 * 1000);
  }

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.store = store;
    this.memoryStore = memoryStore;
  }

  public refreshActivity(): void {
    if (!this.isReady) return;
    this.updateActivity();
  }

  public registerButtonsProvider(provider: PresenceButtonsProvider): () => void {
    this.buttonsProviders.push(provider);
    return () => {
      this.buttonsProviders = this.buttonsProviders.filter((entry) => entry !== provider);
    };
  }

  public registerRemoteActivityProvider(provider: RemoteActivityProvider): () => void {
    this.remoteActivityProviders.push(provider);
    return () => {
      this.remoteActivityProviders = this.remoteActivityProviders.filter((entry) => entry !== provider);
    };
  }

  private buildButtons(): { label: string; url: string }[] | undefined {
    const buttons: PresenceButton[] = [];
    for (const provider of this.buttonsProviders) {
      try {
        buttons.push(...(provider() ?? []));
      } catch (error) {
        log.error("Presence buttons provider failed", error);
      }
    }
    const usable = buttons.filter((button) => button.url.startsWith("https://") || button.url.startsWith("http://"));
    return usable.length > 0 ? usable.slice(0, 2) : undefined;
  }

  private retryDiscordConnection() {
    if (!this.isEnabled) return;

    this.connectionRetries++;
    if (this.connectionRetries === CONNECTION_FAILED_AFTER_ATTEMPTS) {
      this.memoryStore.set("discordPresenceConnectionFailed", true);
    }

    const delay = connectionRetryDelay(this.connectionRetries);
    if (this.connectionRetries <= 3 || this.connectionRetries % 30 === 0) {
      log.info(`Connecting to Discord attempt ${this.connectionRetries} in ${delay / 1000}s`);
    }

    if (this.connectionRetryTimeout !== null) clearTimeout(this.connectionRetryTimeout);
    this.connectionRetryTimeout = setTimeout(() => {
      this.connectionRetryTimeout = null;
      if (!this.isEnabled || !this.discordClient) return;
      try {
        this.discordClient.connect().catch(() => this.retryDiscordConnection());
      } catch (error) {
        log.error("Discord connection attempt failed", error);
        this.retryDiscordConnection();
      }
    }, delay);
  }

  public enable(): void {
    this.isEnabled = true;
    if (this.discordClient) return;
    this.discordClient = new DiscordClient(DISCORD_CLIENT_ID);

    this.discordClient.on("connect", () => {
      this.isReady = true;
      this.connectionRetries = 0;
      this.memoryStore.set("discordPresenceConnectionFailed", false);
    });
    this.discordClient.on("close", () => {
      log.info("Discord connection closed");
      this.isReady = false;
      this.retryDiscordConnection();
    });
    this.discordClient.connect().catch(() => this.retryDiscordConnection());
    this.stateCallback = (event) => {
      try {
        this.playerStateChanged(event);
      } catch (error) {
        log.error("Discord presence state update failed", error);
      }
    };

    playerStateStore.addEventListener(this.stateCallback);
  }

  public disable(): void {
    this.isEnabled = false;
    this.connectionRetries = 0;
    this.memoryStore.set("discordPresenceConnectionFailed", false);

    if (this.activityDebounceTimeout !== null) clearTimeout(this.activityDebounceTimeout);
    if (this.pauseTimeout !== null) clearTimeout(this.pauseTimeout);
    if (this.connectionRetryTimeout !== null) clearTimeout(this.connectionRetryTimeout);
    this.activityDebounceTimeout = this.pauseTimeout = this.connectionRetryTimeout = null;

    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }

    if (!this.discordClient) return;
    this.isReady = false;
    this.discordClient.destroy();
    this.discordClient = null;
  }
}
