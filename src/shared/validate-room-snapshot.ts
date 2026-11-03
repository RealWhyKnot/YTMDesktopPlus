import type { RoomMemberView, RoomSnapshot } from "./room-protocol";
import { arrayOf, isBoolean, isNumber, isString, nullable, objectOf } from "./validation";

const isRole = (value: unknown): value is RoomMemberView["role"] => value === 0 || value === 1;

const isMember = objectOf<RoomMemberView>({ id: isString, name: nullable(isString), role: isRole });

export const isRoomSnapshot = objectOf<RoomSnapshot>({
  phase: (value): value is RoomSnapshot["phase"] =>
    value === "idle" || value === "connecting" || value === "hosting" || value === "listening" || value === "failed",
  roomId: nullable(isString),
  shareUrl: nullable(isString),
  memberId: nullable(isString),
  isHost: isBoolean,
  role: isRole,
  hostName: nullable(isString),
  members: arrayOf(isMember),
  listenerCount: isNumber,
  error: nullable(isString),
  syncStatus: (value): value is RoomSnapshot["syncStatus"] => value === null || value === "loading" || value === "synced" || value === "suspended",
  syncDetail: nullable(isString),
  audioStreaming: isBoolean,
  webListenerCount: isNumber,
  audioIssue: (value): value is RoomSnapshot["audioIssue"] => value === null || value === "retrying" || value === "stopped" || value === "outdated",
});

export function readRoomSnapshot(value: unknown): RoomSnapshot | null {
  if (value === null || value === undefined) return null;
  if (!isRoomSnapshot(value)) throw new TypeError("Invalid room snapshot");
  return value;
}

export function readRoomText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!isString(value)) throw new TypeError("Invalid room text");
  return value;
}
