import { isArray, isRecord } from "./unknown";

export const RELAY_URL = "wss://ytmdesktopplus.com/relay";
export const SHARE_URL_BASE = "https://ytmdesktopplus.com/r/";

export const RELAY_PROTOCOL_VERSION = 1;

export const ROLE_LISTENER = 0;
export const ROLE_CONTROLLER = 1;
export type RoomRole = typeof ROLE_LISTENER | typeof ROLE_CONTROLLER;

export const CONTROL_ACTIONS = ["next", "prev", "play", "pause", "seek", "track"] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];

export function isControlAction(value: unknown): value is ControlAction {
  return CONTROL_ACTIONS.some((action) => action === value);
}

export const MAX_DISPLAY_NAME_LENGTH = 24;

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
  let filtered = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 31 && code !== 127) filtered += character;
  }
  const cleaned = filtered.trim().slice(0, MAX_DISPLAY_NAME_LENGTH).trim();
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
  | { t: "r"; r: string; k?: string; u: string; role: RoomRole; n: number; c: number; v?: number }
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

export function parseServerFrame(raw: string): RoomServerFrame | null {
  if (raw.length > MAX_SERVER_FRAME_BYTES) return null;

  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(frame)) return null;
  switch (frame.t) {
    case "r": {
      if (!isRoomId(frame.r)) return null;
      if (frame.k !== undefined && (typeof frame.k !== "string" || !HOST_KEY_PATTERN.test(frame.k))) return null;
      if (typeof frame.u !== "string" || !MEMBER_ID_PATTERN.test(frame.u)) return null;
      if (!isRole(frame.role) || !isFiniteNumber(frame.n) || !isFiniteNumber(frame.c)) return null;
      if (frame.v !== undefined && !isFiniteNumber(frame.v)) return null;
      const ready: Extract<RoomServerFrame, { t: "r" }> = {
        t: "r",
        r: frame.r,
        k: frame.k,
        u: frame.u,
        role: frame.role,
        n: frame.n,
        c: frame.c,
      };
      if (isFiniteNumber(frame.v)) ready.v = frame.v;
      return ready;
    }
    case "s": {
      if (typeof frame.v !== "string" || !VIDEO_ID_PATTERN.test(frame.v)) return null;
      if (!isFiniteNumber(frame.a) || !isFiniteNumber(frame.c)) return null;
      if (frame.p !== 0 && frame.p !== 1) return null;
      return { t: "s", v: frame.v, a: frame.a, p: frame.p, c: frame.c };
    }
    case "m": {
      if (!isArray(frame.members)) return null;
      if (frame.h !== undefined && typeof frame.h !== "string") return null;
      const members: RoomMember[] = [];
      for (const raw of frame.members) {
        if (!isRecord(raw)) return null;
        if (typeof raw.u !== "string" || !MEMBER_ID_PATTERN.test(raw.u)) return null;
        if (!isRole(raw.r)) return null;
        if (raw.d !== undefined && typeof raw.d !== "string") return null;
        const member: RoomMember = { u: raw.u, r: raw.r };
        const name = sanitizeDisplayName(raw.d);
        if (name !== undefined) member.d = name;
        members.push(member);
      }
      const hostName = sanitizeDisplayName(frame.h);
      return hostName !== undefined ? { t: "m", members, h: hostName } : { t: "m", members };
    }
    case "role": {
      if (!isRole(frame.r)) return null;
      return { t: "role", r: frame.r };
    }
    case "c": {
      if (!isControlAction(frame.a)) return null;
      if (typeof frame.u !== "string" || !MEMBER_ID_PATTERN.test(frame.u)) return null;
      const action = frame.a;
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

export function isMeaningfulChange(previous: RoomStateFrame | null, next: RoomStateFrame, toleranceMs = 1500) {
  if (!previous) return true;
  if (previous.v !== next.v || previous.p !== next.p) return true;
  return Math.abs(previous.a - next.a) > toleranceMs;
}

export function positionMsFrom(frame: { a: number; p: 0 | 1 }, nowMs: number, clockOffsetMs = 0) {
  if (frame.p === 0) return Math.max(0, frame.a);
  return Math.max(0, nowMs + clockOffsetMs - frame.a);
}

export function anchorFrameFrom(videoId: string, progressSeconds: number, isPlaying: boolean, nowMs: number): RoomStateFrame {
  if (isPlaying) return { t: "s", v: videoId, a: nowMs - progressSeconds * 1000, p: 1 };
  return { t: "s", v: videoId, a: progressSeconds * 1000, p: 0 };
}

const CLOCK_SAMPLES = 8;
const CLOCK_SAMPLE_MAX_AGE_MS = 30 * 60_000;

export class ClockOffsetEstimator {
  private samples: { offsetMs: number; rttMs: number; atMs: number }[] = [];

  add(serverMs: number, sentAtMs: number, receivedAtMs: number) {
    const rttMs = Math.max(0, receivedAtMs - sentAtMs);
    const offsetMs = serverMs - (sentAtMs + receivedAtMs) / 2;
    const fresh = this.samples.filter((sample) => receivedAtMs - sample.atMs <= CLOCK_SAMPLE_MAX_AGE_MS);
    this.samples = [...fresh, { offsetMs, rttMs, atMs: receivedAtMs }].slice(-CLOCK_SAMPLES);
  }

  get offsetMs(): number | null {
    let best: { offsetMs: number; rttMs: number } | null = null;
    for (const sample of this.samples) {
      if (!best || sample.rttMs <= best.rttMs) best = sample;
    }
    return best ? best.offsetMs : null;
  }

  reset() {
    this.samples = [];
  }
}

const FATAL_RELAY_ERRORS = new Set(["too many connections", "server busy", "no such room", "room full", "room unavailable", "room closed"]);

export function isFatalRelayError(message: string) {
  return FATAL_RELAY_ERRORS.has(message);
}

export function buildRoomShareUrl(roomId: string) {
  return `${SHARE_URL_BASE}${roomId}`;
}

export const RELAY_ROOM_QUERY = "ytmdproom";

export function relayUrlFor(roomId: string | null) {
  return roomId ? `${RELAY_URL}?${RELAY_ROOM_QUERY}=${encodeURIComponent(roomId)}` : RELAY_URL;
}

export type RoomPhase = "idle" | "connecting" | "hosting" | "listening" | "failed";

export type RoomMemberView = { id: string; name: string | null; role: RoomRole };

export type AudioIssue = "retrying" | "stopped" | "outdated";

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

  audioStreaming: boolean;
  webListenerCount: number;
  audioIssue: AudioIssue | null;
};

export function isRoomLive(snapshot: RoomSnapshot | null): snapshot is RoomSnapshot & { phase: "hosting" | "listening" } {
  return snapshot?.phase === "hosting" || snapshot?.phase === "listening";
}

export function otherListenerCount(snapshot: RoomSnapshot | null): number {
  if (!isRoomLive(snapshot)) return 0;
  return snapshot.listenerCount + snapshot.webListenerCount;
}
