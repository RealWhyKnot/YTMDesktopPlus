import { isRecord } from "./unknown";

export const AUDIO_URL_BASE = "wss://ytmdesktopplus.com/audio/";

export function audioUrlForRoom(roomId: string) {
  return `${AUDIO_URL_BASE}${roomId}`;
}

export const AUDIO_BATCH_VERSION = 1;
export const BATCH_HEADER_BYTES = 16;
export const PACKET_HEADER_BYTES = 6;
export const MAX_BATCH_BYTES = 32768;
export const BATCH_FLAG_DISCONTINUITY = 1;

export const AUDIO_PROTOCOL_VERSION = 1;
export const MAX_AUDIO_TEXT_FRAME = 4096;
export const MAX_META_TEXT_LENGTH = 200;
export const MAX_COVER_URL_LENGTH = 512;
export const PUBLISHER_BURST_BYTES = 98_304;

const COVER_URL_REST = /^[A-Za-z0-9\-._~:/?#[\]@!$&*+,=%]+$/;

export function isCoverUrl(value: string): boolean {
  return value.length <= MAX_COVER_URL_LENGTH && value.startsWith("https://") && COVER_URL_REST.test(value.slice("https://".length));
}

export function sanitizeMetaText(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let filtered = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 31 && code !== 127) filtered += character;
  }
  filtered = filtered.trim();
  let out = "";
  for (const ch of filtered) {
    if (out.length + ch.length > MAX_META_TEXT_LENGTH) break;
    out += ch;
  }
  out = out.trim();
  return out.length > 0 ? out : undefined;
}

export type AudioStatus = "live" | "ad" | "muted";

export type AudioPubFrame = { t: "pub"; r: string; k: string };
export type AudioCfgFrame = { t: "cfg"; codec: "opus"; sr: number; ch: number; br: number };
export type AudioMetaFrame = { t: "meta"; v: string; title?: string; artist?: string; album?: string; coverUrl?: string; durS?: number };
export type AudioAnchorFrame = { t: "anchor"; a: number; p: 0 | 1 };
export type AudioStatusFrame = { t: "status"; s: AudioStatus };
export type AudioClientFrame = AudioPubFrame | AudioCfgFrame | AudioMetaFrame | AudioAnchorFrame | AudioStatusFrame;

export type AudioReadyFrame = { t: "ready"; n?: number; c?: number; v?: number };
export type AudioCountFrame = { t: "n"; n: number };
export type AudioErrorFrame = { t: "e"; m: string };
export type AudioServerFrame = AudioReadyFrame | AudioCountFrame | AudioErrorFrame;

export const FATAL_AUDIO_ERRORS = ["no such room", "bad key", "room closed"];

export function parseAudioServerFrame(raw: string): AudioServerFrame | null {
  if (raw.length > MAX_AUDIO_TEXT_FRAME) return null;

  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(frame)) return null;
  switch (frame.t) {
    case "ready": {
      if (frame.n !== undefined && typeof frame.n !== "number") return null;
      const ready: AudioReadyFrame = { t: "ready", n: frame.n };
      if (typeof frame.c === "number" && Number.isFinite(frame.c)) ready.c = frame.c;
      if (typeof frame.v === "number" && Number.isFinite(frame.v)) ready.v = frame.v;
      return ready;
    }
    case "n": {
      if (typeof frame.n !== "number" || !Number.isFinite(frame.n)) return null;
      return { t: "n", n: frame.n };
    }
    case "e": {
      if (typeof frame.m !== "string") return null;
      return { t: "e", m: frame.m };
    }
    default:
      return null;
  }
}

export type BatchPacket = { timestampUs: number; payload: Uint8Array };

export function encodeBatch(packets: BatchPacket[], batchSeq: number, options?: { discontinuity?: boolean }): Uint8Array {
  const first = packets[0];
  if (first === undefined || packets.length > 0xffff) throw new Error("bad packet count");
  const base = first.timestampUs;
  const total = BATCH_HEADER_BYTES + packets.reduce((sum, packet) => sum + PACKET_HEADER_BYTES + packet.payload.byteLength, 0);
  if (total > MAX_BATCH_BYTES) throw new Error("batch too large");

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint8(0, AUDIO_BATCH_VERSION);
  view.setUint8(1, options?.discontinuity ? BATCH_FLAG_DISCONTINUITY : 0);
  view.setUint16(2, packets.length);
  view.setUint32(4, batchSeq >>> 0);
  view.setFloat64(8, base);

  let offset = BATCH_HEADER_BYTES;
  for (const packet of packets) {
    const delta = packet.timestampUs - base;
    if (delta < 0 || delta > 0xffffffff) throw new Error("bad packet timestamp");
    view.setUint32(offset, delta);
    view.setUint16(offset + 4, packet.payload.byteLength);
    out.set(packet.payload, offset + PACKET_HEADER_BYTES);
    offset += PACKET_HEADER_BYTES + packet.payload.byteLength;
  }
  return out;
}
