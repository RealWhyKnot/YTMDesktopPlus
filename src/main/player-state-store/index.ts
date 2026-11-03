import { EventEmitter } from "events";
import { readIntegerPrefix } from "~shared/integer-prefix";
import log from "electron-log";
import {
  LikeStatus,
  RepeatMode,
  VideoState,
  VideoType,
  type PlayerQueue,
  type PlayerQueueItem,
  type PlayerState,
  type Thumbnail,
  type VideoDetails,
} from "~shared/addons/sdk";

import type { QueueItemPayload, QueuePayload, VideoDetailsPayload } from "../ipc/ytm-view-payloads";
import { createPlayerEventDeriver } from "./derived-events";

export { LikeStatus, RepeatMode, VideoState, VideoType };
export type { PlayerQueue, PlayerQueueItem, PlayerState, Thumbnail, VideoDetails };

const YTMVideoState = {
  Unstarted: -1,
  [-1]: "Unstarted",
  Ended: 0,
  [0]: "Ended",
  Playing: 1,
  [1]: "Playing",
  Paused: 2,
  [2]: "Paused",
  Buffering: 3,
  [3]: "Buffering",
  VideoCued: 5,
  [5]: "VideoCued",
} as const;

function mapYTMThumbnails(thumbnail: { url: string; width?: unknown; height?: unknown }): Thumbnail[] {
  if (typeof thumbnail.width !== "number" || !Number.isFinite(thumbnail.width) || typeof thumbnail.height !== "number" || !Number.isFinite(thumbnail.height)) {
    return [];
  }
  return [
    {
      url: thumbnail.url,
      width: thumbnail.width,
      height: thumbnail.height,
    },
  ];
}

function mapQueueItem(item: QueueItemPayload): PlayerQueueItem {
  return {
    ...item,
    thumbnails: item.thumbnails.flatMap(mapYTMThumbnails),
    counterparts: item.counterparts === null ? null : item.counterparts.map(mapQueueItem),
  };
}

function mapQueueItems(items: (QueueItemPayload | null)[]): (PlayerQueueItem | null)[] {
  return items.map((item) => (item === null ? null : mapQueueItem(item)));
}

function transformRepeatMode(repeatMode: string | null | undefined) {
  switch (repeatMode) {
    case "NONE": {
      return RepeatMode.None;
    }

    case "ALL": {
      return RepeatMode.All;
    }

    case "ONE": {
      return RepeatMode.One;
    }

    case null:
    case undefined:
    default: {
      return RepeatMode.Unknown;
    }
  }
}

function transformLikeStatus(likeStatus: string | null | undefined) {
  switch (likeStatus) {
    case "DISLIKE": {
      return LikeStatus.Dislike;
    }

    case "INDIFFERENT": {
      return LikeStatus.Indifferent;
    }

    case "LIKE": {
      return LikeStatus.Like;
    }

    case null:
    case undefined:
    default: {
      return LikeStatus.Unknown;
    }
  }
}

function transformVideoType(videoType: string | null | undefined) {
  switch (videoType) {
    case "MUSIC_VIDEO_TYPE_ATV": {
      return VideoType.MusicAudio;
    }

    case "MUSIC_VIDEO_TYPE_OMV":
    case "MUSIC_VIDEO_TYPE_UGC": {
      return VideoType.MusicVideo;
    }

    case "MUSIC_VIDEO_TYPE_PRIVATELY_OWNED_TRACK": {
      return VideoType.MusicUploaded;
    }

    case "MUSIC_VIDEO_TYPE_PODCAST_EPISODE": {
      return VideoType.PodcastEpisode;
    }

    case null:
    case undefined:
    default: {
      return VideoType.Unknown;
    }
  }
}

class PlayerStateStore {
  private videoProgress = 0;
  private state: VideoState = -1;
  private videoDetails: VideoDetails | null = null;
  private playlistId: string | null | undefined = null;
  private queue: PlayerQueue | null = null;
  private volume = 0;
  private isMuted = false;
  private isAdPlaying = false;
  private hasFullMetadata = false;
  private eventEmitter = new EventEmitter();

  constructor() {
    this.eventEmitter.on("error", (error) => {
      log.error("PlayerStateStore EventEmitter threw an error", error);
    });
  }

  public getState(): PlayerState {
    return {
      videoDetails: this.videoDetails,
      playlistId: this.playlistId,
      trackState: this.state,
      queue: this.queue,
      videoProgress: this.videoProgress,
      volume: this.volume,
      muted: this.isMuted,
      adPlaying: this.isAdPlaying,
      hasFullMetadata: this.hasFullMetadata,
    };
  }

  public getQueue() {
    return this.queue;
  }

  public getPlaylistId() {
    return this.playlistId;
  }

  public updateVideoProgress(progress: number) {
    this.videoProgress = progress;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateVideoState(state: number) {
    switch (state) {
      case YTMVideoState.Paused: {
        this.state = VideoState.Paused;
        break;
      }

      case YTMVideoState.Playing: {
        this.state = VideoState.Playing;
        break;
      }

      case YTMVideoState.Buffering: {
        this.state = VideoState.Buffering;
        break;
      }

      default: {
        this.state = VideoState.Unknown;
        break;
      }
    }
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateVideoDetails(
    videoDetails: VideoDetailsPayload,
    playlistId: string | null | undefined,
    album: { id?: string | null; text?: string | null } | null,
    likeStatus: string | null | undefined,
    hasFullMetadata: boolean
  ) {
    this.videoDetails = {
      author: videoDetails.author ?? "",
      channelId: videoDetails.channelId ?? "",
      title: videoDetails.title ?? "",
      album: album?.text ?? null,
      albumId: album?.id ?? null,
      likeStatus: transformLikeStatus(likeStatus),
      thumbnails: videoDetails.thumbnail ? videoDetails.thumbnail.thumbnails.flatMap(mapYTMThumbnails) : [],
      durationSeconds: readIntegerPrefix(String(videoDetails.lengthSeconds)),
      id: videoDetails.videoId,
      videoType: transformVideoType(videoDetails.musicVideoType),
      isLive: !!videoDetails.isLive,
    };
    this.playlistId = playlistId;
    this.hasFullMetadata = hasFullMetadata;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateQueue(queue: QueuePayload | null) {
    this.queue = queue
      ? {
          automixItems: mapQueueItems(queue.automixItems),
          autoplay: queue.autoplay,
          isGenerating: queue.isGenerating,

          isInfinite: queue.isInfinite,
          items: mapQueueItems(queue.items),
          repeatMode: transformRepeatMode(queue.repeatMode),

          selectedItemIndex: queue.items.findIndex((item) => item?.selected),
        }
      : null;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateFromStore(
    likeStatus: string | null | undefined,
    volume: number | null | undefined,
    isMuted: boolean | null | undefined,
    isAdPlaying: boolean | null | undefined
  ) {
    if (this.videoDetails) {
      const nextLikeStatus = transformLikeStatus(likeStatus);
      if (nextLikeStatus !== this.videoDetails.likeStatus) this.videoDetails = { ...this.videoDetails, likeStatus: nextLikeStatus };
    }
    this.isAdPlaying = isAdPlaying === true;
    this.isMuted = isMuted === true;
    if (typeof volume === "number" && volume >= 0) this.volume = volume;

    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public addEventListener(listener: (state: PlayerState) => void) {
    this.eventEmitter.addListener("stateChanged", listener);
  }

  public removeEventListener(listener: (state: PlayerState) => void) {
    this.eventEmitter.removeListener("stateChanged", listener);
  }
}

const playerStateStore = new PlayerStateStore();

export const playerEvents = new EventEmitter();
playerEvents.setMaxListeners(100);
{
  const deriver = createPlayerEventDeriver((event, payload) => playerEvents.emit(event, payload));
  playerStateStore.addEventListener((state) => deriver.next(state));
}

export { playerStateStore };
