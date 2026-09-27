import { EventEmitter } from "events";
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
  type VideoDetails
} from "~shared/addons/sdk";

import type { ProjectedQueue } from "~shared/queue-projection";
import { createPlayerEventDeriver } from "./derived-events";

export { LikeStatus, RepeatMode, VideoState, VideoType };
export type { PlayerQueue, PlayerQueueItem, PlayerState, Thumbnail, VideoDetails };

enum YTMVideoState {
  Unstarted = -1,
  Ended = 0,
  Playing = 1,
  Paused = 2,
  Buffering = 3,
  VideoCued = 5
}

type YTMThumbnail = {
  height: number;
  url: string;
  width: number;
};

type YTMRepeatMode = "NONE" | "ALL" | "ONE";

type YTMLikeStatus = "INDIFFERENT" | "DISLIKE" | "LIKE";

type YTMVideoDetails = {
  album: string;
  author: string;
  channelId: string;
  lengthSeconds: string;
  thumbnail: {
    thumbnails: YTMThumbnail[];
  };
  title: string;
  videoId: string;
  isLive: boolean;
  musicVideoType: string;
};

function mapYTMThumbnails(thumbnail: YTMThumbnail) {
  // Explicit mapping to keep a consistent API
  // If YouTube Music changes how this is presented internally then it's easier to update without breaking the API
  return {
    url: thumbnail.url,
    width: thumbnail.width,
    height: thumbnail.height
  };
}

// This may seem redundant but we do this in case YTM changes its own data to accomodate and prevent severe breaking of things
function transformRepeatMode(repeatMode: YTMRepeatMode) {
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

    default: {
      return RepeatMode.Unknown;
    }
  }
}

function transformLikeStatus(likeStatus: YTMLikeStatus) {
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

    default: {
      return LikeStatus.Unknown;
    }
  }
}

function transformVideoType(videoType: string) {
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

    default: {
      return VideoType.Unknown;
    }
  }
}

class PlayerStateStore {
  private videoProgress = 0;
  private state: VideoState = -1;
  private videoDetails: VideoDetails | null = null;
  private playlistId: string | null = null;
  private queue: PlayerQueue | null = null;
  private volume: number = 0;
  private muted: boolean = false;
  private adPlaying: boolean = false;
  private hasFullMetadata: boolean = false;
  private eventEmitter = new EventEmitter();

  constructor() {
    this.eventEmitter.on("error", error => {
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
      muted: this.muted,
      adPlaying: this.adPlaying,
      hasFullMetadata: this.hasFullMetadata
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

  public updateVideoState(state: YTMVideoState) {
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
    videoDetails: YTMVideoDetails,
    playlistId: string,
    album: { id: string; text: string } | null,
    likeStatus: YTMLikeStatus,
    hasFullMetadata: boolean
  ) {
    this.videoDetails = {
      author: videoDetails.author,
      channelId: videoDetails.channelId,
      title: videoDetails.title,
      album: album?.text ?? null,
      albumId: album?.id ?? null,
      likeStatus: transformLikeStatus(likeStatus),
      thumbnails: videoDetails.thumbnail ? videoDetails.thumbnail.thumbnails.map(mapYTMThumbnails) : [], // There are cases where the thumbnails simply don't exist on the videoDetails but can be found via other means. Podcasts notably can do this
      durationSeconds: parseInt(videoDetails.lengthSeconds),
      id: videoDetails.videoId,
      videoType: transformVideoType(videoDetails.musicVideoType),
      isLive: !!videoDetails.isLive
    };
    this.playlistId = playlistId;
    this.hasFullMetadata = hasFullMetadata;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateQueue(queue: ProjectedQueue | null) {
    this.queue = queue
      ? {
          // automixItems comes from an autoplay queue that isn't pushed yet to the main queue. A radio will never have automixItems (weird YTM distinction from autoplay vs radio)
          automixItems: queue.automixItems,
          autoplay: queue.autoplay,
          isGenerating: queue.isGenerating,
          // Observed state seems to be a radio having infinite true while an autoplay queue has infinite false
          isInfinite: queue.isInfinite,
          items: queue.items,
          repeatMode: transformRepeatMode(queue.repeatMode as YTMRepeatMode),
          // YTM has a native selectedItemIndex property but that isn't updated correctly so we calculate it ourselves
          selectedItemIndex: queue.items.findIndex(item => item?.selected)
        }
      : null;
    this.eventEmitter.emit("stateChanged", this.getState());
  }

  public updateFromStore(likeStatus: YTMLikeStatus | null, volume: number | null, muted: boolean | null, adPlaying: boolean | null) {
    if (this.videoDetails) {
      this.videoDetails.likeStatus = transformLikeStatus(likeStatus);
    }
    this.adPlaying = adPlaying === true;
    this.muted = muted === true;
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

/** Granular events derived once from the snapshot stream; every consumer
 *  shares this one subscription. Event names and payloads: PlayerEventMap. */
export const playerEvents = new EventEmitter();
playerEvents.setMaxListeners(100);
{
  const deriver = createPlayerEventDeriver((event, payload) => playerEvents.emit(event, payload));
  playerStateStore.addEventListener(state => deriver.next(state));
}

export default playerStateStore;
