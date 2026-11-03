import type { ProjectedQueue } from "~shared/queue-projection";
import type { PlayerQueueItem } from "~shared/addons/sdk";

type Thumbnail = { url: string; width?: unknown; height?: unknown };

export type QueueItemPayload = Omit<PlayerQueueItem, "thumbnails" | "counterparts"> & {
  thumbnails: Thumbnail[];
  counterparts: QueueItemPayload[] | null;
};

export type QueuePayload = Omit<ProjectedQueue, "items" | "automixItems"> & {
  items: (QueueItemPayload | null)[];
  automixItems: (QueueItemPayload | null)[];
};

export type VideoDetailsPayload = {
  videoId: string;
  title?: string | null;
  author?: string | null;
  channelId?: string | null;
  lengthSeconds?: string | null;
  musicVideoType?: string | null;
  isLive?: unknown;
  album?: string | null;
  thumbnail?: { thumbnails: Thumbnail[] } | null;
};

export type AlbumPayload = { id?: string | null; text?: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptional(value: unknown, type: "string" | "boolean" | "number"): boolean {
  return value === undefined || value === null || typeof value === type;
}

function isThumbnail(value: unknown): boolean {
  return isRecord(value) && typeof value.url === "string";
}

function isQueueEntry(value: unknown, ancestors: Set<Record<string, unknown>>): boolean {
  if (!isRecord(value) || ancestors.has(value)) return false;
  for (const field of ["title", "author", "duration", "videoId"]) {
    if (typeof value[field] !== "string") return false;
  }
  if (typeof value.selected !== "boolean" || !Array.isArray(value.thumbnails) || !Array.from(value.thumbnails).every(isThumbnail)) return false;
  const counterparts = value.counterparts;
  ancestors.add(value);
  const isValid = counterparts === null || (Array.isArray(counterparts) && Array.from(counterparts).every((item) => isQueueEntry(item, ancestors)));
  ancestors.delete(value);
  return isValid;
}

function isEntryList(value: unknown): boolean {
  return Array.isArray(value) && Array.from(value).every((item) => item === null || isQueueEntry(item, new Set()));
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isOptionalString(value: unknown): value is string | null | undefined {
  return isOptional(value, "string");
}

export function isOptionalNumber(value: unknown): value is number | null | undefined {
  return isOptional(value, "number");
}

export function isOptionalBoolean(value: unknown): value is boolean | null | undefined {
  return isOptional(value, "boolean");
}

export function isVideoDetailsPayload(value: unknown): value is VideoDetailsPayload {
  if (!isRecord(value) || typeof value.videoId !== "string") return false;
  for (const key of ["title", "author", "channelId", "lengthSeconds", "musicVideoType", "album"]) {
    if (!isOptional(value[key], "string")) return false;
  }
  const thumbnail = value.thumbnail;
  if (thumbnail === undefined || thumbnail === null) return true;
  return isRecord(thumbnail) && Array.isArray(thumbnail.thumbnails) && thumbnail.thumbnails.every(isThumbnail);
}

export function isAlbumPayload(value: unknown): value is AlbumPayload | null | undefined {
  if (value === undefined || value === null) return true;
  return isRecord(value) && isOptional(value.id, "string") && isOptional(value.text, "string");
}

export function isQueuePayload(value: unknown): value is QueuePayload | null {
  if (value === null) return true;
  return (
    isRecord(value) &&
    isEntryList(value.items) &&
    isEntryList(value.automixItems) &&
    typeof value.autoplay === "boolean" &&
    typeof value.isGenerating === "boolean" &&
    typeof value.isInfinite === "boolean" &&
    typeof value.repeatMode === "string"
  );
}

export function isStoreStatePayload(likeStatus: unknown, volume: unknown, muted: unknown, adPlaying: unknown): boolean {
  return isOptionalString(likeStatus) && isOptionalNumber(volume) && isOptionalBoolean(muted) && isOptionalBoolean(adPlaying);
}

export function createPayloadRejectLog(warn: (message: string) => void) {
  const reported = new Set<string>();
  return (channel: string) => {
    if (reported.has(channel)) return;
    reported.add(channel);
    warn(`Dropped a malformed ${channel} message from the YTM view`);
  };
}
