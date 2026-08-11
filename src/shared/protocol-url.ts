// Parsing and building of ytmdplus:// links.
//
// The listen along link carries a position so a shared track opens where the
// sharer is, not at the start. Two forms, because they mean different things:
//
//   ?at=<epoch ms>   the wall clock at which the track was at position 0, so
//                    the position keeps advancing while the link sits unread
//   ?t=<seconds>     a frozen position, used when the sharer is paused and
//                    there is nothing to advance
//
// ytmdplus: is a non-special scheme, so URL parsing has two quirks worth
// pinning: the host keeps its original case, and a link written without "//"
// has no host at all and puts the command in the first path segment.
//
// The shared form of the link is https, not the scheme itself: Discord only
// accepts http(s) urls on activity buttons, so the button carries the /p/
// share page and that page forwards into ytmdplus://play with the same path
// and query.

export type PositionAnchor = { kind: "absolute"; seconds: number } | { kind: "anchor"; epochMs: number };

export type ProtocolCommand =
  | {
      command: "play";
      videoId: string;
      playlistId: string | null;
      anchor: PositionAnchor | null;
    }
  | {
      // Any other command is routed to whichever feature registered it; the
      // handler owns validation of its own segments.
      command: "other";
      name: string;
      segments: string[];
      params: URLSearchParams;
    };

export type ListenAlongUrlArgs = {
  videoId: string;
  playlistId?: string | null;
  positionSeconds: number;
  playing: boolean;
  durationSeconds: number;
  isLive: boolean;
  adPlaying: boolean;
  nowMs: number;
};

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PLAYLIST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

// Seeking this close to the start costs an audible stutter and gains nothing.
const MIN_SEEK_SECONDS = 3;
// A link opened this close to the end has gone stale; start the track instead
// of dropping the listener on the outro.
const END_GUARD_SECONDS = 5;
// Below this we emit no query param; the receiver just starts the track.
export const ANCHOR_OMIT_SECONDS = 5;

// Base of the share page that forwards into ytmdplus://play, same host the
// room share links live on.
export const PLAY_SHARE_URL_BASE = "https://ytmdesktopplus.com/p/";

function decodeSegments(pathname: string): string[] | null {
  const segments: string[] = [];
  for (const segment of pathname.split("/")) {
    if (segment.length === 0) continue;
    try {
      segments.push(decodeURIComponent(segment));
    } catch {
      return null;
    }
  }
  return segments;
}

function parseAnchor(params: URLSearchParams): PositionAnchor | null {
  const at = params.get("at");
  if (at !== null) {
    const epochMs = Number(at);
    if (Number.isFinite(epochMs) && epochMs > 0) return { kind: "anchor", epochMs };
    return null;
  }

  const t = params.get("t");
  if (t !== null) {
    const seconds = Number(t);
    if (Number.isFinite(seconds) && seconds >= 0) return { kind: "absolute", seconds };
  }
  return null;
}

export function parseProtocolUrl(input: string): ProtocolCommand | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "ytmdplus:") return null;

  const segments = decodeSegments(url.pathname);
  if (segments === null) return null;

  const command = (url.hostname || segments.shift() || "").toLowerCase();
  if (command.length === 0) return null;

  if (command !== "play") {
    return { command: "other", name: command, segments, params: url.searchParams };
  }

  if (segments.length > 2) return null;

  const videoId = segments[0] ?? "";
  if (!VIDEO_ID_PATTERN.test(videoId)) return null;

  const playlistId = segments[1] ?? url.searchParams.get("list");
  if (playlistId !== null && playlistId !== undefined && !PLAYLIST_ID_PATTERN.test(playlistId)) return null;

  return {
    command: "play",
    videoId,
    playlistId: playlistId ?? null,
    anchor: parseAnchor(url.searchParams)
  };
}

// Returns null when the track should play from the start. Callers treat that as
// a first-class outcome rather than seeking to 0.
export function resolveStartSeconds(anchor: PositionAnchor | null, nowMs: number, durationSeconds: number | null): number | null {
  if (anchor === null) return null;

  const seconds = anchor.kind === "absolute" ? anchor.seconds : (nowMs - anchor.epochMs) / 1000;
  if (!Number.isFinite(seconds) || seconds < MIN_SEEK_SECONDS) return null;

  if (durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    if (seconds > durationSeconds - END_GUARD_SECONDS) return null;
  }

  return Math.floor(seconds);
}

export function buildListenAlongUrl(args: ListenAlongUrlArgs): string {
  const base = `${PLAY_SHARE_URL_BASE}${args.videoId}${args.playlistId ? `/${args.playlistId}` : ""}`;

  const positionUnusable = args.adPlaying || args.isLive || !Number.isFinite(args.durationSeconds) || args.durationSeconds <= 0;
  if (positionUnusable) return base;
  if (!Number.isFinite(args.positionSeconds) || args.positionSeconds < ANCHOR_OMIT_SECONDS) return base;

  if (args.playing) return `${base}?at=${Math.round(args.nowMs - args.positionSeconds * 1000)}`;
  return `${base}?t=${Math.floor(args.positionSeconds)}`;
}
