import type { PositionAnchor } from "./addons/sdk";

export type ProtocolCommand = {
  name: string;
  segments: string[];
  params: URLSearchParams;
};

const MIN_SEEK_SECONDS = 3;

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

  const name = (url.hostname.length > 0 ? url.hostname : (segments.shift() ?? "")).toLowerCase();
  if (name.length === 0) return null;

  return { name, segments, params: url.searchParams };
}

export function resolveStartSeconds(anchor: PositionAnchor | null, nowMs: number, durationSeconds: number | null): number | null {
  if (anchor === null) return null;

  const seconds = anchor.kind === "absolute" ? anchor.seconds : (nowMs - anchor.epochMs) / 1000;
  if (!Number.isFinite(seconds) || seconds < MIN_SEEK_SECONDS) return null;

  if (durationSeconds !== null && Number.isFinite(durationSeconds) && durationSeconds > 0) {
    if (seconds > durationSeconds - END_GUARD_SECONDS) return null;
  }

  return Math.floor(seconds);
}
