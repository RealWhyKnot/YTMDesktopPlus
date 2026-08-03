// Client half of the Listen Along relay protocol.
//
// The relay speaks small JSON frames with single-character keys over a plain
// WebSocket. The host publishes an anchor rather than a position: while
// playing, `a` is the wall clock at which the track was at 0:00, so listeners
// derive their own position locally and a steady-playing track costs nothing
// on the wire. While paused, `a` is the frozen position in milliseconds and
// `p` says which reading applies.

export const ROOM_PROTOCOL_VERSION = 1;

export const RELAY_URL = "wss://ytmdesktopplus.com/relay";
export const SHARE_URL_BASE = "https://ytmdesktopplus.com/r/";

export const ROLE_LISTENER = 0;
export const ROLE_CONTROLLER = 1;
export type RoomRole = typeof ROLE_LISTENER | typeof ROLE_CONTROLLER;

export const CONTROL_ACTIONS = ["next", "prev", "play", "pause", "seek", "track"] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export const MAX_DISPLAY_NAME_LENGTH = 24;

// No i, l, o, 0 or 1: room codes get read aloud and retyped.
export const ROOM_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const ROOM_ID_PATTERN = new RegExp(`^[${ROOM_ID_ALPHABET}]{8}$`);
const MEMBER_ID_PATTERN = new RegExp(`^[${ROOM_ID_ALPHABET}]{6}$`);
const HOST_KEY_PATTERN = /^[0-9a-f]{32}$/;
const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_SERVER_FRAME_BYTES = 65536;

export function isRoomId(value: unknown): value is string {
  return typeof value === "string" && ROOM_ID_PATTERN.test(value);
}

export function sanitizeDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = [...value]
    .filter(ch => {
      const code = ch.codePointAt(0) ?? 0;
      return code > 31 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, MAX_DISPLAY_NAME_LENGTH)
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

export type RoomStateFrame = { t: "s"; v: string; a: number; p: 0 | 1 };
export type RoomClientFrame =
  | { t: "h"; r?: string; k?: string; d?: string }
  | { t: "j"; r: string; d?: string }
  | RoomStateFrame
  | { t: "c"; a: ControlAction; m?: number; v?: string }
  | { t: "g"; u: string; r: RoomRole }
  | { t: "x" };

export function encodeClientFrame(frame: RoomClientFrame): string {
  return JSON.stringify(frame);
}

export type RoomMember = { u: string; r: RoomRole; d?: string };

export type RoomServerFrame =
  | { t: "r"; r: string; k?: string; u: string; role: RoomRole; n: number; c: number }
  | { t: "s"; v: string; a: number; p: 0 | 1; c: number }
  | { t: "m"; members: RoomMember[]; h?: string }
  | { t: "role"; r: RoomRole }
  | { t: "c"; a: ControlAction; m?: number; v?: string; u: string }
  | { t: "n"; n: number }
  | { t: "e"; m: string };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRole(value: unknown): value is RoomRole {
  return value === ROLE_LISTENER || value === ROLE_CONTROLLER;
}

// The relay is not trusted blindly: frames are validated the same way the
// relay validates ours.
export function parseServerFrame(raw: string): RoomServerFrame | null {
  if (raw.length > MAX_SERVER_FRAME_BYTES) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const frame = value as Record<string, unknown>;
  switch (frame.t) {
    case "r": {
      if (!isRoomId(frame.r)) return null;
      if (frame.k !== undefined && !HOST_KEY_PATTERN.test(String(frame.k))) return null;
      if (typeof frame.u !== "string" || !MEMBER_ID_PATTERN.test(frame.u)) return null;
      if (!isRole(frame.role) || !isFiniteNumber(frame.n) || !isFiniteNumber(frame.c)) return null;
      return { t: "r", r: frame.r, k: frame.k as string | undefined, u: frame.u, role: frame.role, n: frame.n, c: frame.c };
    }
    case "s": {
      if (typeof frame.v !== "string" || !VIDEO_ID_PATTERN.test(frame.v)) return null;
      if (!isFiniteNumber(frame.a) || !isFiniteNumber(frame.c)) return null;
      if (frame.p !== 0 && frame.p !== 1) return null;
      return { t: "s", v: frame.v, a: frame.a, p: frame.p, c: frame.c };
    }
    case "m": {
      if (!Array.isArray(frame.members)) return null;
      if (frame.h !== undefined && typeof frame.h !== "string") return null;
      const members: RoomMember[] = [];
      for (const entry of frame.members) {
        if (typeof entry !== "object" || entry === null) return null;
        const raw = entry as Record<string, unknown>;
        if (typeof raw.u !== "string" || !MEMBER_ID_PATTERN.test(raw.u)) return null;
        if (!isRole(raw.r)) return null;
        if (raw.d !== undefined && typeof raw.d !== "string") return null;
        const member: RoomMember = { u: raw.u, r: raw.r };
        if (typeof raw.d === "string") member.d = raw.d;
        members.push(member);
      }
      return frame.h !== undefined ? { t: "m", members, h: frame.h as string } : { t: "m", members };
    }
    case "role": {
      if (!isRole(frame.r)) return null;
      return { t: "role", r: frame.r };
    }
    case "c": {
      if (typeof frame.a !== "string" || !CONTROL_ACTIONS.includes(frame.a as ControlAction)) return null;
      if (typeof frame.u !== "string" || !MEMBER_ID_PATTERN.test(frame.u)) return null;
      const action = frame.a as ControlAction;
      if (action === "seek") {
        if (!isFiniteNumber(frame.m) || frame.m < 0) return null;
        return { t: "c", a: action, m: frame.m, u: frame.u };
      }
      if (action === "track") {
        if (typeof frame.v !== "string" || !VIDEO_ID_PATTERN.test(frame.v)) return null;
        return { t: "c", a: action, v: frame.v, u: frame.u };
      }
      return { t: "c", a: action, u: frame.u };
    }
    case "n": {
      if (!isFiniteNumber(frame.n)) return null;
      return { t: "n", n: frame.n };
    }
    case "e": {
      if (typeof frame.m !== "string" || frame.m.length > 256) return null;
      return { t: "e", m: frame.m };
    }
    default:
      return null;
  }
}

// Mirrors the relay's send gate: a steady-playing track produces no frames.
export function isMeaningfulChange(previous: RoomStateFrame | null, next: RoomStateFrame, toleranceMs = 1500) {
  if (!previous) return true;
  if (previous.v !== next.v || previous.p !== next.p) return true;
  return Math.abs(previous.a - next.a) > toleranceMs;
}

export function positionMsFrom(frame: { a: number; p: 0 | 1 }, nowMs: number, clockOffsetMs = 0) {
  if (frame.p === 0) return Math.max(0, frame.a);
  return Math.max(0, nowMs + clockOffsetMs - frame.a);
}

export function anchorFrameFrom(videoId: string, progressSeconds: number, playing: boolean, nowMs: number): RoomStateFrame {
  if (playing) return { t: "s", v: videoId, a: nowMs - progressSeconds * 1000, p: 1 };
  return { t: "s", v: videoId, a: progressSeconds * 1000, p: 0 };
}

// The relay closes the socket right after these; anything else leaves it open.
const FATAL_RELAY_ERRORS = new Set(["too many connections", "server busy", "no such room", "room full", "room unavailable", "room closed"]);

export function isFatalRelayError(message: string) {
  return FATAL_RELAY_ERRORS.has(message);
}

export function buildRoomShareUrl(roomId: string) {
  return `${SHARE_URL_BASE}${roomId}`;
}

// View model the main process publishes for the room UI.
export type RoomPhase = "idle" | "connecting" | "hosting" | "listening" | "failed";

export type RoomMemberView = { id: string; name: string | null; role: RoomRole };

export type RoomSnapshot = {
  phase: RoomPhase;
  roomId: string | null;
  shareUrl: string | null;
  memberId: string | null;
  isHost: boolean;
  role: RoomRole;
  hostName: string | null;
  members: RoomMemberView[];
  listenerCount: number;
  error: string | null;
  syncStatus: "loading" | "synced" | "suspended" | null;
  syncDetail: string | null;
};
