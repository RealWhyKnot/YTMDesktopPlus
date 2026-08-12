// Client side of the relay's /audio channel. The relay repository holds the
// canonical copy of these constants and the batch layout; the two are kept in
// deliberate sync the same way room-protocol.ts mirrors the relay protocol.
//
// One socket carries JSON text frames (authentication, codec config, track
// metadata, anchors, status, listener count) and binary frames of batched
// Opus packets. The edge routes /audio/<roomId> to the node that owns the
// room, so the client only ever needs this one URL.

export const AUDIO_URL_BASE = "wss://ytmdesktopplus.com/audio/";

export function audioUrlForRoom(roomId: string) {
  return `${AUDIO_URL_BASE}${roomId}`;
}

export const AUDIO_BATCH_VERSION = 1;
export const BATCH_HEADER_BYTES = 16;
export const PACKET_HEADER_BYTES = 6;
export const MAX_BATCH_BYTES = 32768;
export const BATCH_FLAG_DISCONTINUITY = 1;

export const MAX_AUDIO_TEXT_FRAME = 4096;

export type AudioStatus = "live" | "ad" | "muted";

export type AudioPubFrame = { t: "pub"; r: string; k: string };
export type AudioCfgFrame = { t: "cfg"; codec: "opus"; sr: number; ch: number; br: number };
export type AudioMetaFrame = { t: "meta"; v: string; title?: string; artist?: string; album?: string; coverUrl?: string; durS?: number };
export type AudioAnchorFrame = { t: "anchor"; a: number; p: 0 | 1 };
export type AudioStatusFrame = { t: "status"; s: AudioStatus };
export type AudioClientFrame = AudioPubFrame | AudioCfgFrame | AudioMetaFrame | AudioAnchorFrame | AudioStatusFrame;

export type AudioReadyFrame = { t: "ready"; n?: number };
export type AudioCountFrame = { t: "n"; n: number };
export type AudioErrorFrame = { t: "e"; m: string };
export type AudioServerFrame = AudioReadyFrame | AudioCountFrame | AudioErrorFrame;

// Errors after which redialing the same room is pointless.
export const FATAL_AUDIO_ERRORS = ["no such room", "bad key", "room closed"];

/** Parses what the relay sends a publisher. Unknown frames are null. */
export function parseAudioServerFrame(raw: string): AudioServerFrame | null {
  if (raw.length > MAX_AUDIO_TEXT_FRAME) return null;

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;

  const frame = value as Record<string, unknown>;
  switch (frame.t) {
    case "ready": {
      if (frame.n !== undefined && typeof frame.n !== "number") return null;
      return { t: "ready", n: frame.n as number | undefined };
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

/**
 * Builds a binary batch in the wire layout:
 *
 *   u8 version | u8 flags | u16be packetCount | u32be batchSeq
 *   | f64be baseTimestampUs
 *   | packetCount x { u32be deltaTimestampUs, u16be byteLength, bytes }
 */
export function encodeBatch(packets: BatchPacket[], batchSeq: number, options?: { discontinuity?: boolean }): Uint8Array {
  if (packets.length === 0 || packets.length > 0xffff) throw new Error("bad packet count");
  const base = packets[0].timestampUs;
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
