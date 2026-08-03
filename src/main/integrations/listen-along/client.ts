import { io, type Socket } from "socket.io-client";

import { VideoState } from "../../player-state-store";
import type { Sample } from "./types";

export const APP_ID = "ytmdplus_listenalong";
export const APP_NAME = "YTMDesktop+ Listen Along";

// Long enough to cover the host's own approval window.
const PAIR_TIMEOUT_MS = 40000;
const REQUEST_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 10000;
const LATENCY_CLAMP_MS = 1000;

export class ListenAlongError extends Error {
  public readonly detail: string;

  constructor(detail: string) {
    super(detail);
    this.name = "ListenAlongError";
    this.detail = detail;
  }
}

// The shape the companion server puts on the wire.
type RemoteState = {
  player: { trackState: number; videoProgress: number; adPlaying: boolean } | null;
  video: { id: string; durationSeconds: number } | null;
};

export function baseUrl(host: string, port: number) {
  return `http://${host}:${port}`;
}

export function sampleFromRemoteState(state: RemoteState, asOfMs: number): Sample {
  return {
    videoId: state?.video?.id ?? null,
    durationSeconds: state?.video?.durationSeconds ?? 0,
    progress: state?.player?.videoProgress ?? 0,
    trackState: (state?.player?.trackState ?? VideoState.Unknown) as VideoState,
    adPlaying: state?.player?.adPlaying ?? false,
    asOfMs
  };
}

async function request(url: string, init: RequestInit, timeoutMs: number) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: abort.signal });
  } catch (error) {
    if (abort.signal.aborted) throw new ListenAlongError("Timed out reaching the host");
    const code = (error as NodeJS.ErrnoException & { cause?: NodeJS.ErrnoException })?.cause?.code;
    if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ETIMEDOUT" || code === "ENOTFOUND") {
      throw new ListenAlongError("Can't reach host - check the host is running and its firewall allows the connection");
    }
    throw new ListenAlongError("Can't reach host");
  } finally {
    clearTimeout(timer);
  }
}

function pairingFailure(status: number, body: string) {
  if (status === 403 && body.includes("AUTHORIZATION_DENIED")) return "Host declined the request";
  if (status === 403) return "Host has companion authorization turned off";
  if (status === 504) return "Host did not respond in time";
  if (status === 503) return "Host is handling too many authorization requests";
  return `Host rejected the request (${status})`;
}

// Walks the companion server's two step authorization. The code has to be shown
// to whoever is at the host machine, so it is handed back as soon as it exists
// and the caller waits on the returned token.
export async function pair(host: string, port: number, appVersion: string, onCode: (code: string) => void) {
  const root = `${baseUrl(host, port)}/api/v1`;

  const codeResponse = await request(
    `${root}/auth/requestcode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: APP_ID, appName: APP_NAME, appVersion })
    },
    REQUEST_TIMEOUT_MS
  );
  if (!codeResponse.ok) throw new ListenAlongError(pairingFailure(codeResponse.status, await codeResponse.text()));

  const { code } = (await codeResponse.json()) as { code: string };
  onCode(code);

  const tokenResponse = await request(
    `${root}/auth/request`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: APP_ID, code })
    },
    PAIR_TIMEOUT_MS
  );
  if (!tokenResponse.ok) throw new ListenAlongError(pairingFailure(tokenResponse.status, await tokenResponse.text()));

  const { token } = (await tokenResponse.json()) as { token: string };
  return token;
}

// Seeds the first sample and measures round trip latency at the same time. The
// state route is rate limited to one call per five seconds per token, so a 429
// is expected on a quick reconnect and is not an error.
export async function fetchState(host: string, port: number, token: string) {
  const sentAt = Date.now();
  const response = await request(`${baseUrl(host, port)}/api/v1/state`, { headers: { Authorization: token } }, REQUEST_TIMEOUT_MS);
  const receivedAt = Date.now();

  if (response.status === 401) throw new ListenAlongError("Host revoked access - pair again");
  if (response.status === 429) return null;
  if (!response.ok) throw new ListenAlongError(`Host returned ${response.status}`);

  const roundTripMs = receivedAt - sentAt;
  const oneWayMs = Math.min(Math.max(roundTripMs / 2, 0), LATENCY_CLAMP_MS);
  return {
    oneWayMs,
    sample: sampleFromRemoteState((await response.json()) as RemoteState, receivedAt - oneWayMs)
  };
}

export type RealtimeHandlers = {
  onState: (state: RemoteState) => void;
  onDisconnect: () => void;
  onAuthFailure: () => void;
};

// The server runs websocket only with upgrades disabled, so a polling handshake
// is rejected outright. Reconnection is driven by the integration instead of the
// client, because only the integration can tell a rebooted host from a revoked
// token.
export function connectRealtime(host: string, port: number, token: string, handlers: RealtimeHandlers): Socket {
  const socket = io(`${baseUrl(host, port)}/api/v1/realtime`, {
    transports: ["websocket"],
    auth: { token },
    reconnection: false,
    timeout: CONNECT_TIMEOUT_MS
  });

  socket.on("state-update", handlers.onState);
  socket.on("connect_error", error => {
    if (/unauthenticated|authentication/i.test(error.message)) {
      handlers.onAuthFailure();
      return;
    }
    handlers.onDisconnect();
  });
  socket.on("disconnect", handlers.onDisconnect);

  return socket;
}
