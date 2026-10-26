import type { ProjectedQueue } from "~shared/queue-projection";

type Thumbnail = { url: string; width: number; height: number };

export type VideoDetailsPayload = {
  videoId: string;
  title?: string;
  author?: string;
  channelId?: string;
  lengthSeconds?: string;
  musicVideoType?: string;
  isLive?: boolean;
  album?: string;
  thumbnail?: { thumbnails: Thumbnail[] } | null;
};

export type AlbumPayload = { id: string; text: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptional(value: unknown, type: "string" | "boolean" | "number"): boolean {
  return value === undefined || value === null || typeof value === type;
}

function isThumbnail(value: unknown): boolean {
  return isRecord(value) && typeof value.url === "string";
}

function isQueueEntry(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const counterparts = value.counterparts;
  return counterparts === undefined || counterparts === null || (Array.isArray(counterparts) && counterparts.every(isRecord));
}

function isEntryList(value: unknown): boolean {
  return Array.isArray(value) && value.every(isQueueEntry);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isOptionalString(value: unknown): value is string | null | undefined {
  return isOptional(value, "string");
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

export function isQueuePayload(value: unknown): value is ProjectedQueue | null {
  if (value === null) return true;
  return (
    isRecord(value) &&
    isEntryList(value.items) &&
    isEntryList(value.automixItems) &&
    isOptional(value.autoplay, "boolean") &&
    isOptional(value.isGenerating, "boolean") &&
    isOptional(value.isInfinite, "boolean") &&
    isOptional(value.repeatMode, "string")
  );
}

export function isStoreStatePayload(likeStatus: unknown, volume: unknown, muted: unknown, adPlaying: unknown): boolean {
  return isOptional(likeStatus, "string") && isOptional(volume, "number") && isOptional(muted, "boolean") && isOptional(adPlaying, "boolean");
}

export function createPayloadRejectLog(warn: (message: string) => void) {
  const reported = new Set<string>();
  return (channel: string) => {
    if (reported.has(channel)) return;
    reported.add(channel);
    warn(`Dropped a malformed ${channel} message from the YTM view`);
  };
}
