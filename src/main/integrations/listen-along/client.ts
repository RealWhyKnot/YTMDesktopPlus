import { io, type Socket } from "socket.io-client";

import { VideoState } from "../../player-state-store";
import type { Sample } from "./types";
import { isRecord } from "~shared/unknown";
import { isBoolean, isNumber, isString, nullable, objectOf, optional } from "~shared/validation";

export const APP_ID = "ytmdplus_listenalong";
export const APP_NAME = "YTMDesktop+ Listen Along";

const PAIR_TIMEOUT_MS = 40000;
const REQUEST_TIMEOUT_MS = 10000;
const CONNECT_TIMEOUT_MS = 10000;
const LATENCY_CLAMP_MS = 1000;

export class ListenAlongError extends Error {
  public override name = "ListenAlongError";
  public readonly detail: string;

  constructor(detail: string, options?: ErrorOptions) {
    super(detail, options);
    this.detail = detail;
  }
}

type RemoteState = {
  player?: { trackState?: VideoState | null; videoProgress?: number | null; adPlaying?: boolean | null } | null;
  video?: { id?: string | null; durationSeconds?: number | null } | null;
};

const isRemoteState = optional(
  nullable(
    objectOf<RemoteState>({
      player: optional(
        nullable(
          objectOf({
            trackState: optional(
              nullable(
                (value: unknown): value is VideoState =>
                  value === VideoState.Unknown || value === VideoState.Paused || value === VideoState.Playing || value === VideoState.Buffering
              )
            ),
            videoProgress: optional(nullable(isNumber)),
            adPlaying: optional(nullable(isBoolean)),
          })
        )
      ),
      video: optional(nullable(objectOf({ id: optional(nullable(isString)), durationSeconds: optional(nullable(isNumber)) }))),
    })
  )
);

export function baseUrl(host: string, port: number) {
  return `http://${host}:${port}`;
}

export function sampleFromRemoteState(state: RemoteState | null | undefined, asOfMs: number): Sample {
  return {
    videoId: state?.video?.id ?? null,
    durationSeconds: state?.video?.durationSeconds ?? 0,
    progress: state?.player?.videoProgress ?? 0,
    trackState: state?.player?.trackState ?? VideoState.Unknown,
    adPlaying: state?.player?.adPlaying ?? false,
    asOfMs,
  };
}

async function request(url: string, init: RequestInit, timeoutMs: number) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: abort.signal });
  } catch (error) {
    if (abort.signal.aborted) throw new ListenAlongError("Timed out reaching the host", { cause: error });
    const cause = isRecord(error) ? error.cause : undefined;
    const code = isRecord(cause) ? cause.code : undefined;
    if (code === "ECONNREFUSED" || code === "EHOSTUNREACH" || code === "ETIMEDOUT" || code === "ENOTFOUND") {
      throw new ListenAlongError("Can't reach host - check the host is running and its firewall allows the connection", { cause: error });
    }
    throw new ListenAlongError("Can't reach host", { cause: error });
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

export async function pair(host: string, port: number, appVersion: string, onCode: (code: string) => void) {
  const root = `${baseUrl(host, port)}/api/v1`;

  const codeResponse = await request(
    `${root}/auth/requestcode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: APP_ID, appName: APP_NAME, appVersion }),
    },
    REQUEST_TIMEOUT_MS
  );
  if (!codeResponse.ok) throw new ListenAlongError(pairingFailure(codeResponse.status, await codeResponse.text()));

  const codeBody: unknown = await codeResponse.json();
  if (!isRecord(codeBody) || typeof codeBody.code !== "string") throw new ListenAlongError("Host returned an invalid pairing code");
  const { code } = codeBody;
  onCode(code);

  const tokenResponse = await request(
    `${root}/auth/request`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appId: APP_ID, code }),
    },
    PAIR_TIMEOUT_MS
  );
  if (!tokenResponse.ok) throw new ListenAlongError(pairingFailure(tokenResponse.status, await tokenResponse.text()));

  const tokenBody: unknown = await tokenResponse.json();
  if (!isRecord(tokenBody) || typeof tokenBody.token !== "string") throw new ListenAlongError("Host returned an invalid pairing token");
  return tokenBody.token;
}

export async function fetchState(host: string, port: number, token: string) {
  const sentAt = Date.now();
  const response = await request(`${baseUrl(host, port)}/api/v1/state`, { headers: { Authorization: token } }, REQUEST_TIMEOUT_MS);
  const receivedAt = Date.now();

  if (response.status === 401) throw new ListenAlongError("The host revoked access. Pair again.");
  if (response.status === 429) return null;
  if (!response.ok) throw new ListenAlongError(`Host returned ${response.status}`);

  const roundTripMs = receivedAt - sentAt;
  const oneWayMs = Math.min(Math.max(roundTripMs / 2, 0), LATENCY_CLAMP_MS);
  const state: unknown = await response.json();
  if (!isRemoteState(state)) throw new ListenAlongError("Host returned an invalid player state");
  return {
    oneWayMs,
    sample: sampleFromRemoteState(state, receivedAt - oneWayMs),
  };
}

export type RealtimeHandlers = {
  onState: (state: RemoteState | null | undefined) => void;
  onDisconnect: () => void;
  onAuthFailure: () => void;
};

export function connectRealtime(host: string, port: number, token: string, handlers: RealtimeHandlers): Socket {
  const socket = io(`${baseUrl(host, port)}/api/v1/realtime`, {
    transports: ["websocket"],
    auth: { token },
    reconnection: false,
    timeout: CONNECT_TIMEOUT_MS,
  });

  socket.on("state-update", (state: unknown) => {
    if (!isRemoteState(state)) throw new ListenAlongError("Host returned an invalid player state");
    handlers.onState(state);
  });
  socket.on("connect_error", (error) => {
    if (/unauthenticated|authentication/i.test(error.message)) {
      handlers.onAuthFailure();
      return;
    }
    handlers.onDisconnect();
  });
  socket.on("disconnect", handlers.onDisconnect);

  return socket;
}
