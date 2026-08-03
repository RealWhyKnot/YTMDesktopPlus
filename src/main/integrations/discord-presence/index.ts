import type Conf from "conf";

import playerStateStore, { PlayerState, Thumbnail, VideoDetails, VideoState } from "../../player-state-store";
import IIntegration from "../integration";
import MemoryStore from "../../memory-store";
import { MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import DiscordClient from "./minimal-discord-client";
import log from "electron-log";
import { DiscordActivityType } from "./minimal-discord-client/types";
import { buildListenAlongUrl } from "~shared/protocol-url";
import type { RoomSnapshot } from "~shared/room-protocol";

const DISCORD_CLIENT_ID = "1533867163079671849";

function getHighestResThumbnail(thumbnails: Thumbnail[]): string {
  return thumbnails.reduce(
    (accumulator, current) => (current.height * current.width <= accumulator.height * accumulator.width ? accumulator : current),
    thumbnails[0]
  ).url;
}

function getSmallImageKey(state: VideoState) {
  // Developer Note:
  // These are asset keys on the Discord application, not files in this repo.
  // Add "-inverted" to either key for the dark variant (white glyph on black).
  switch (state) {
    case VideoState.Playing: {
      return "start";
    }
    default: {
      return "pause";
    }
  }
}

function getSmallImageText(state: VideoState) {
  switch (state) {
    case VideoState.Playing: {
      return "Playing";
    }
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
    return str.padEnd(minimum, "​"); // There's a zero width space here
  }
  return str;
}

export default class DiscordPresence implements IIntegration {
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;

  private discordClient: DiscordClient = null;
  private enabled = false;
  private ready = false;
  private activityDebounceTimeout: NodeJS.Timeout | null = null;
  private pauseTimeout: string | number | NodeJS.Timeout = null;
  private connectionRetryTimeout: string | number | NodeJS.Timeout = null;
  private stateCallback: (event: PlayerState) => void = null;

  private videoState: VideoState | null = null;
  private videoDetails: Partial<VideoDetails> | null = null;
  private progress: number | null = null;
  private adPlaying = false;

  private connectionRetries: number = 0;

  private UpdateActivity() {
    if (this.activityDebounceTimeout) return;
    this.activityDebounceTimeout = setTimeout(() => {
      if (!this.videoDetails) {
        this.discordClient.clearActivity();
        return;
      }
      const { title, author, album, id, thumbnails, durationSeconds, channelId, albumId, isLive } = this.videoDetails;
      const thumbnail = getHighestResThumbnail(thumbnails);
      const playing = this.videoState === VideoState.Playing;
      // One clock read, so the elapsed bar and the listen along link agree.
      const nowMs = Date.now();
      const startEpochMs = nowMs - this.progress * 1000;
      this.discordClient.setActivity({
        type: DiscordActivityType.Listening,
        status_display_type: 1,
        details: stringLimit(title, 128, 2),
        details_url: `https://music.youtube.com/watch?v=${id}`,
        state: stringLimit(author, 128, 2),
        state_url: `https://music.youtube.com/channel/${channelId}`,
        timestamps: {
          start: playing ? startEpochMs : undefined,
          end: playing ? nowMs + (durationSeconds - this.progress) * 1000 : undefined
        },
        assets: {
          large_image: (thumbnail?.length ?? 0) <= 256 ? thumbnail : "icon",
          large_text: album ? stringLimit(album, 128, 2) : undefined,
          large_url: albumId ? `https://music.youtube.com/browse/${albumId}` : undefined,
          small_image: getSmallImageKey(this.videoState),
          small_text: getSmallImageText(this.videoState)
        },
        instance: false,
        buttons: this.buildButtons(
          buildListenAlongUrl({
            videoId: id,
            positionSeconds: this.progress,
            playing,
            durationSeconds,
            isLive,
            adPlaying: this.adPlaying,
            nowMs
          })
        )
      });
      this.activityDebounceTimeout = null;
    }, 1000);
  }

  private playerStateChanged(state: PlayerState) {
    if (!this.ready) return;

    const { videoDetails, videoProgress, trackState, hasFullMetadata } = state;
    if (!videoDetails) {
      this.discordClient.clearActivity();
      return;
    }
    this.adPlaying = state.adPlaying;
    const oldState = this.videoState ?? null;
    const oldId = this.videoDetails?.id ?? null;
    const oldProgress = this.progress ?? null;
    this.videoState = trackState;
    this.videoDetails = videoDetails;
    this.progress = Math.floor(videoProgress);
    if (
      hasFullMetadata &&
      (oldState !== this.videoState || oldId !== this.videoDetails.id || Math.abs(this.progress - oldProgress) > 1 || oldProgress > this.progress)
    ) {
      this.UpdateActivity();
    }

    clearTimeout(this.pauseTimeout);
    this.pauseTimeout = null;
    if (state.trackState == VideoState.Playing) return;
    this.pauseTimeout = setTimeout(() => {
      if (!this.discordClient && !this.ready) return;
      this.discordClient.clearActivity();
      this.pauseTimeout = null;
    }, 30 * 1000);
  }

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.store = store;
    this.memoryStore = memoryStore;
  }

  /** Rebuilds the activity when something other than playback changed it, like a room opening or closing. */
  public refreshActivity(): void {
    if (!this.ready) return;
    this.UpdateActivity();
  }

  // The master toggle removes the Listen Along surface entirely; Discord has
  // no disabled state for buttons, so absence is the only off switch. While
  // hosting a room the share link rides along as a second button.
  private buildButtons(listenAlongUrl: string): { label: string; url: string }[] | undefined {
    if (!this.store?.get("integrations").listenAlongRoomsEnabled) return undefined;

    const buttons: { label: string; url: string }[] = [];
    const room = this.memoryStore.get("listenAlongRoom") as RoomSnapshot | null;
    if (room && room.phase === "hosting" && room.shareUrl) {
      buttons.push({ label: "Join Room", url: room.shareUrl });
    }
    buttons.push({ label: "Listen Along", url: listenAlongUrl });
    return buttons;
  }

  private retryDiscordConnection() {
    if (!this.enabled) return;
    if (this.connectionRetries >= 30) {
      this.memoryStore.set("discordPresenceConnectionFailed", true);
      return;
    }

    this.connectionRetries++;
    log.info(`Connecting to Discord attempt ${this.connectionRetries}/30`);

    clearTimeout(this.connectionRetryTimeout);
    this.connectionRetryTimeout = setTimeout(() => {
      if (!this.discordClient) return;
      this.discordClient.connect().catch(() => this.retryDiscordConnection());
    }, 5 * 1000);
  }

  public enable(): void {
    this.enabled = true;
    if (this.discordClient) return;
    this.discordClient = new DiscordClient(DISCORD_CLIENT_ID);

    this.discordClient.on("connect", () => {
      this.ready = true;
      this.connectionRetries = 0;
      this.memoryStore.set("discordPresenceConnectionFailed", false);
    });
    this.discordClient.on("close", () => {
      log.info("Discord connection closed");
      this.ready = false;
      this.retryDiscordConnection();
    });
    this.discordClient.connect().catch(() => this.retryDiscordConnection());
    this.stateCallback = event => {
      this.playerStateChanged(event);
    };

    playerStateStore.addEventListener(this.stateCallback);
  }

  public disable(): void {
    this.enabled = false;
    this.connectionRetries = 0;
    this.memoryStore.set("discordPresenceConnectionFailed", false);

    clearTimeout(this.activityDebounceTimeout);
    clearTimeout(this.pauseTimeout);
    clearTimeout(this.connectionRetryTimeout);
    this.activityDebounceTimeout = this.pauseTimeout = this.connectionRetryTimeout = null;

    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
    }

    if (!this.discordClient) return;
    this.ready = false;
    this.discordClient.destroy();
    this.discordClient = null;
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
