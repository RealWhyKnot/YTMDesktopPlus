// Parsing of ytmdplus:// links, and the shared rule for turning a position
// anchor into a seek target.
//
// ytmdplus: is a non-special scheme, so URL parsing has two quirks worth
// pinning: the host keeps its original case, and a link written without "//"
// has no host at all and puts the command in the first path segment.
//
// Every command is owned by whichever feature registered it; the handler
// validates its own segments.

import type { PositionAnchor } from "./addons/sdk";

export type { PositionAnchor } from "./addons/sdk";

export type ProtocolCommand = {
  name: string;
  segments: string[];
  params: URLSearchParams;
};

// Seeking this close to the start costs an audible stutter and gains nothing.
const MIN_SEEK_SECONDS = 3;
// A position this close to the end has gone stale; start the track instead of
// dropping the listener on the outro.
const END_GUARD_SECONDS = 5;

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

  const name = (url.hostname || segments.shift() || "").toLowerCase();
  if (name.length === 0) return null;

  return { name, segments, params: url.searchParams };
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
