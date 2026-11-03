import { shell, safeStorage } from "electron";
import { createQueryString, createBody, createApiSig } from "./request-params";

import { playerStateStore, type PlayerState, type VideoDetails, VideoState } from "../../player-state-store";
import { SEEK_JUMP_SECONDS } from "../../player-state-store/derived-events";
import { launchPauseArmedFor } from "../../playback/launch-pause";

import type { Integration } from "../integration";
import { type StoreSchema } from "~shared/store/schema";
import { type LastfmApiResult, type LastfmRequestBody } from "./schemas";
import log from "electron-log";
import { isRecord } from "~shared/unknown";

const API_URL = "https://ws.audioscrobbler.com/2.0/";
const REQUEST_TIMEOUT_MS = 30_000;

export const MIN_SCROBBLE_DURATION_SECONDS = 30;
export const MAX_SCROBBLE_PLAY_SECONDS = 240;
export const REPLAY_START_SECONDS = 3;
export const AUTH_POLL_INITIAL_MS = 3 * 1000;
export const AUTH_POLL_MAX_MS = 30 * 1000;
export const AUTH_TOKEN_LIFETIME_MS = 60 * 60 * 1000;
export const BACKOFF_INITIAL_MS = 30 * 1000;
export const BACKOFF_MAX_MS = 30 * 60 * 1000;
export const MAX_PENDING_SCROBBLES = 50;

const AUTH_ERROR_CODES = new Set([4, 9, 14, 15]);
const TEMPORARY_ERROR_CODES = new Set([8, 11, 16, 29]);
const TOKEN_PENDING_CODE = 14;

type Play = {
  videoDetails: VideoDetails;
  playedSeconds: number;
  startedAt: number | null;
  lastProgress: number | null;
  lastTickAt: number | null;
  nowPlayingSent: boolean;
  scrobbled: boolean;
  heldForLaunch: boolean;
};

type PendingScrobble = { videoDetails: VideoDetails; timestamp: number };

type AuthFlow = { cancelled: boolean; timer: NodeJS.Timeout | null; wake: (() => void) | null };

type LastfmStore = {
  get(key: "lastfm"): StoreSchema["lastfm"];
  get(key: "lastfm.scrobblePercent"): unknown;
  set(key: "lastfm.sessionKey" | "lastfm.token", value: string | null): void;
};

type LastfmMemory = { get(key: "safeStorageAvailable"): unknown };

type SessionResult = "connected" | "pending" | "expired";

export class LastFM implements Integration {
  private storeValue: LastfmStore | undefined;
  private get store(): LastfmStore {
    const value = this.storeValue;
    if (value === undefined) throw new Error("Integration store has not been provided");
    return value;
  }
  private set store(value: LastfmStore) {
    this.storeValue = value;
  }
  private memoryStoreValue: LastfmMemory | undefined;
  private get memoryStore(): LastfmMemory {
    const value = this.memoryStoreValue;
    if (value === undefined) throw new Error("Integration memoryStore has not been provided");
    return value;
  }
  private set memoryStore(value: LastfmMemory) {
    this.memoryStoreValue = value;
  }

  private isEnabled = false;

  private possibleVideoIds: string[] | null = null;
  private lastfmDetails: StoreSchema["lastfm"] | null = null;
  private get currentSettings(): StoreSchema["lastfm"] {
    if (this.lastfmDetails === null) throw new Error("Last.fm settings are not loaded");
    return this.lastfmDetails;
  }

  private play: Play | null = null;
  private playerStateFunction: ((state: PlayerState) => void) | undefined;

  private authFlow: AuthFlow | null = null;
  private backoffMs = 0;
  private backoffUntil = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private pendingScrobbles: PendingScrobble[] = [];
  private isFlushing = false;

  private async callApi(params: Partial<LastfmRequestBody>, httpMethod: "GET" | "POST"): Promise<LastfmApiResult> {
    let response: Response;
    try {
      if (httpMethod === "GET") {
        const apiSig = createApiSig(params, this.currentSettings.secret);
        response = await fetch(`${API_URL}?${createQueryString(params, apiSig)}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      } else {
        const data = { ...params, api_sig: createApiSig(params, this.currentSettings.secret) };
        response = await fetch(API_URL, { method: "POST", body: createBody(data), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      }
    } catch (error) {
      return { ok: false, kind: "temporary", code: null, message: String(error) };
    }

    let json: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = await response.json();
      if (isRecord(parsed)) json = parsed;
    } catch {
      json = null;
    }

    if (json && typeof json.error === "number") {
      const code = json.error;
      const message = typeof json.message === "string" ? json.message : "";
      if (AUTH_ERROR_CODES.has(code)) return { ok: false, kind: "auth", code, message };
      if (TEMPORARY_ERROR_CODES.has(code)) return { ok: false, kind: "temporary", code, message };
      return { ok: false, kind: "fatal", code, message };
    }

    if (!response.ok || !json) {
      const isTemporary = !json || response.status >= 500 || response.status === 429;
      return { ok: false, kind: isTemporary ? "temporary" : "fatal", code: null, message: `HTTP ${response.status}` };
    }

    return { ok: true, json };
  }

  private async createToken(): Promise<string | null> {
    const result = await this.callApi({ method: "auth.gettoken", format: "json", api_key: this.currentSettings.api_key }, "GET");
    if (!result.ok) {
      log.warn(`Last.fm token request failed: ${result.code ?? ""} ${result.message}`);
      return null;
    }
    const token = result.json.token;
    return typeof token === "string" && token.length > 0 ? token : null;
  }

  private async requestSession(token: string): Promise<SessionResult> {
    const result = await this.callApi({ method: "auth.getSession", format: "json", api_key: this.currentSettings.api_key, token }, "GET");
    if (result.ok) {
      const session = result.json.session;
      const key = isRecord(session) ? session.key : undefined;
      if (typeof key !== "string" || key.length === 0) return "pending";
      this.currentSettings.sessionKey = key;
      void this.saveSettings().catch((error: unknown) => log.warn("requestSession failed", error));
      log.info("Last.fm connected");
      this.flushPending();
      return "connected";
    }
    if (result.kind === "temporary" || result.code === TOKEN_PENDING_CODE) return "pending";
    log.info(`Last.fm token is no longer usable: ${result.code ?? ""} ${result.message}`);
    return "expired";
  }

  private waitFor(flow: AuthFlow, ms: number): Promise<void> {
    return new Promise((resolve) => {
      flow.wake = resolve;
      flow.timer = setTimeout(() => {
        flow.timer = null;
        flow.wake = null;
        resolve();
      }, ms);
    });
  }

  private async pollSession(flow: AuthFlow, token: string, deadline: number): Promise<SessionResult> {
    const isCancelled = () => flow.cancelled;
    let delay = AUTH_POLL_INITIAL_MS;
    while (!isCancelled() && Date.now() < deadline) {
      await this.waitFor(flow, delay);
      if (isCancelled()) return "expired";
      const result = await this.requestSession(token);
      if (result !== "pending") return result;
      delay = Math.min(delay * 2, AUTH_POLL_MAX_MS);
    }
    return "expired";
  }

  private async runAuthFlow(flow: AuthFlow): Promise<void> {
    const isCancelled = () => flow.cancelled;
    const storedToken = this.currentSettings.token;
    if (storedToken) {
      const result = await this.requestSession(storedToken);
      if (isCancelled() || result === "connected") return;
      if (result === "pending") {
        const polled = await this.pollSession(flow, storedToken, Date.now() + AUTH_TOKEN_LIFETIME_MS);
        if (isCancelled() || polled === "connected") return;
      }
    }

    const token = await this.createToken();
    if (isCancelled() || !token) return;
    this.currentSettings.token = token;
    void this.saveSettings().catch((error: unknown) => log.warn("runAuthFlow failed", error));

    shell
      .openExternal(`https://www.last.fm/api/auth/` + `?api_key=${encodeURIComponent(this.currentSettings.api_key)}` + `&token=${encodeURIComponent(token)}`)
      .catch((error: unknown) => log.error("Could not open the Last.fm sign in page", error));

    await this.pollSession(flow, token, Date.now() + AUTH_TOKEN_LIFETIME_MS);
  }

  public connect(): void {
    if (!this.isEnabled || this.authFlow || !this.lastfmDetails || this.currentSettings.sessionKey) return;
    const flow: AuthFlow = { cancelled: false, timer: null, wake: null };
    this.authFlow = flow;
    void this.runAuthFlow(flow)
      .catch((error: unknown) => log.error("Last.fm sign in failed", error))
      .finally(() => {
        if (this.authFlow === flow) this.authFlow = null;
      })
      .catch((error: unknown) => log.warn("connect failed", error));
  }

  private cancelAuthFlow() {
    const flow = this.authFlow;
    if (!flow) return;
    this.authFlow = null;
    flow.cancelled = true;
    if (flow.timer) clearTimeout(flow.timer);
    flow.timer = null;
    flow.wake?.();
    flow.wake = null;
  }

  private trackIdsFor(state: PlayerState): string[] {
    const selectedItem = state.queue?.items[state.queue.selectedItemIndex];
    return [...(selectedItem?.counterparts?.map((item) => item.videoId) ?? []), ...(selectedItem?.videoId ? [selectedItem.videoId] : [])];
  }

  private startPlay(state: PlayerState): Play {
    const videoDetails = state.videoDetails;
    if (videoDetails === null) throw new Error("Cannot start a Last.fm play without video details");
    const ids = this.trackIdsFor(state);
    this.possibleVideoIds = ids.includes(videoDetails.id) ? ids : [...ids, videoDetails.id];
    this.play = {
      videoDetails,
      playedSeconds: 0,
      startedAt: null,
      lastProgress: null,
      lastTickAt: null,
      nowPlayingSent: false,
      scrobbled: false,
      heldForLaunch: false,
    };
    return this.play;
  }

  private scrobblePercent(): number {
    const stored = Number(this.storeValue?.get("lastfm.scrobblePercent"));
    if (!Number.isFinite(stored)) return 50;
    return Math.min(Math.max(stored, 50), 100);
  }

  private hasKnownDuration(videoDetails: VideoDetails) {
    return Number.isFinite(videoDetails.durationSeconds) && videoDetails.durationSeconds > 0;
  }

  private isScrobbleable(videoDetails: VideoDetails) {
    return !this.hasKnownDuration(videoDetails) || videoDetails.durationSeconds > MIN_SCROBBLE_DURATION_SECONDS;
  }

  private scrobbleThreshold(videoDetails: VideoDetails) {
    if (!this.hasKnownDuration(videoDetails)) return MAX_SCROBBLE_PLAY_SECONDS;
    return Math.min(Math.round((videoDetails.durationSeconds * this.scrobblePercent()) / 100), MAX_SCROBBLE_PLAY_SECONDS);
  }

  private addPlayed(play: Play, seconds: number, now: number) {
    play.playedSeconds += seconds;
    play.startedAt ??= now - seconds * 1000;

    const videoDetails = play.videoDetails;
    if (!this.isScrobbleable(videoDetails)) return;

    if (!play.nowPlayingSent) {
      play.nowPlayingSent = true;
      this.updateNowPlaying(videoDetails).catch((error: unknown) => log.error("Last.fm now playing failed", error));
    }

    if (!play.scrobbled && play.playedSeconds >= this.scrobbleThreshold(videoDetails)) {
      play.scrobbled = true;
      this.scrobbleSong(videoDetails, play.startedAt).catch((error: unknown) => log.error("Last.fm scrobble failed", error));
    }
  }

  private updatePlayerState(state: PlayerState): Promise<void> {
    return new Promise((resolve) => {
      this.applyPlayerState(state);
      resolve();
    });
  }

  private applyPlayerState(state: PlayerState): void {
    if (!this.isEnabled) {
      return;
    }

    const videoDetails = state.videoDetails;
    if (!videoDetails) {
      if (this.play) {
        this.play.lastProgress = null;
        this.play.lastTickAt = null;
      }
      return;
    }

    if (!this.play || !this.possibleVideoIds?.includes(videoDetails.id)) {
      this.startPlay(state);
    } else {
      this.play.videoDetails = videoDetails;
      const ids = this.trackIdsFor(state);
      if (ids.includes(videoDetails.id)) this.possibleVideoIds = ids;
    }

    const play = this.play;
    if (play === null) throw new Error("Last.fm play was not initialized");
    const isPlaying = state.trackState === VideoState.Playing;
    if (!isPlaying) play.heldForLaunch = false;
    else if (launchPauseArmedFor() === videoDetails.id) play.heldForLaunch = true;

    const progress = state.videoProgress;
    if (!isPlaying || state.adPlaying || play.heldForLaunch || !Number.isFinite(progress)) {
      play.lastProgress = null;
      play.lastTickAt = null;
      return;
    }

    if (play.lastProgress === progress) return;

    const now = Date.now();
    if (play.lastProgress !== null && play.scrobbled && progress <= REPLAY_START_SECONDS && play.lastProgress - progress > SEEK_JUMP_SECONDS) {
      const replay = this.startPlay(state);
      replay.lastProgress = progress;
      replay.lastTickAt = now;
      return;
    }

    if (play.lastProgress !== null && play.lastTickAt !== null) {
      const delta = progress - play.lastProgress;
      const elapsed = (now - play.lastTickAt) / 1000;
      if (delta > 0 && delta <= elapsed + SEEK_JUMP_SECONDS) this.addPlayed(play, delta, now);
    }
    play.lastProgress = progress;
    play.lastTickAt = now;
  }

  private async updateNowPlaying(videoDetails: VideoDetails): Promise<void> {
    if (!this.lastfmDetails?.sessionKey || Date.now() < this.backoffUntil) return;

    const result = await this.sendToLastFM(videoDetails, { method: "track.updateNowPlaying" });
    this.handleTrackResult(result, null);
  }

  private async scrobbleSong(videoDetails: VideoDetails, scrobbleTime: number): Promise<void> {
    if (videoDetails.title === "" || videoDetails.author === "") return;
    const pending: PendingScrobble = { videoDetails, timestamp: Math.floor(scrobbleTime / 1000) };
    if (!this.lastfmDetails?.sessionKey || Date.now() < this.backoffUntil || this.isFlushing) {
      this.queueScrobble(pending);
      return;
    }

    const result = await this.sendScrobble(pending);
    this.handleTrackResult(result, pending);
  }

  private sendScrobble(pending: PendingScrobble) {
    return this.sendToLastFM(pending.videoDetails, { method: "track.scrobble", timestamp: pending.timestamp });
  }

  private handleTrackResult(result: LastfmApiResult, pending: PendingScrobble | null) {
    if (result.ok) {
      this.backoffMs = 0;
      this.backoffUntil = 0;
      this.flushPending();
      return;
    }

    switch (result.kind) {
      case "auth": {
        if (pending) this.queueScrobble(pending);
        this.dropSession(result);
        break;
      }

      case "temporary": {
        if (pending) this.queueScrobble(pending);
        this.backOff(result);
        break;
      }

      case "fatal": {
        log.warn(`Last.fm rejected ${pending ? "a scrobble" : "now playing"}: ${result.code ?? ""} ${result.message}`);
      }
    }
  }

  private queueScrobble(pending: PendingScrobble) {
    if (this.pendingScrobbles.includes(pending)) return;
    this.pendingScrobbles.push(pending);
    if (this.pendingScrobbles.length > MAX_PENDING_SCROBBLES) this.pendingScrobbles.shift();
  }

  private dropSession(result: LastfmApiResult) {
    if (!this.lastfmDetails?.sessionKey) return;
    log.warn(`Last.fm session expired (error ${!result.ok ? result.code : ""}). Turn Last.fm off and on again to reconnect.`);
    this.currentSettings.sessionKey = null;
    try {
      this.store.set("lastfm.sessionKey", null);
    } catch (error) {
      log.error(error);
    }
  }

  private backOff(result: LastfmApiResult) {
    this.backoffMs = this.backoffMs ? Math.min(this.backoffMs * 2, BACKOFF_MAX_MS) : BACKOFF_INITIAL_MS;
    this.backoffUntil = Date.now() + this.backoffMs;
    log.warn(`Last.fm is unavailable, retrying in ${this.backoffMs / 1000}s: ${!result.ok ? `${result.code ?? ""} ${result.message}` : ""}`);
    this.scheduleRetry(this.backoffMs);
  }

  private scheduleRetry(ms: number) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.flushPending();
    }, ms);
  }

  private flushPending() {
    if (this.isFlushing || this.pendingScrobbles.length === 0 || !this.isEnabled) return;
    if (!this.lastfmDetails?.sessionKey || Date.now() < this.backoffUntil) return;
    this.isFlushing = true;
    void this.flushQueue()
      .catch((error: unknown) => log.error("Last.fm retry failed", error))
      .finally(() => {
        this.isFlushing = false;
      })
      .catch((error: unknown) => log.warn("flushPending failed", error));
  }

  private async flushQueue() {
    while (this.isEnabled && this.pendingScrobbles.length > 0 && this.lastfmDetails?.sessionKey && Date.now() >= this.backoffUntil) {
      const pending = this.pendingScrobbles.shift();
      if (pending === undefined) break;
      const result = await this.sendScrobble(pending);
      if (!result.ok) {
        if (result.kind === "fatal") {
          log.warn(`Last.fm rejected a scrobble: ${result.code ?? ""} ${result.message}`);
          continue;
        }
        this.pendingScrobbles.unshift(pending);
        if (result.kind === "auth") this.dropSession(result);
        else this.backOff(result);
        return;
      }
      this.backoffMs = 0;
      this.backoffUntil = 0;
    }
  }

  private sendToLastFM(videoDetails: VideoDetails, params: Partial<LastfmRequestBody>): Promise<LastfmApiResult> {
    if (videoDetails.title === "" || videoDetails.author === "") {
      return Promise.resolve({ ok: false, kind: "fatal", code: 6, message: "Missing title or artist" });
    }
    const data: Partial<LastfmRequestBody> = {
      ...params,

      artist: videoDetails.author,
      track: videoDetails.title,
      album: videoDetails.album ?? undefined,
      duration: this.hasKnownDuration(videoDetails) ? videoDetails.durationSeconds : undefined,

      format: "json",
      api_key: this.currentSettings.api_key,
      sk: this.currentSettings.sessionKey,
    };

    return this.callApi(data, "POST");
  }

  public provide(store: LastfmStore, memoryStore: LastfmMemory): void {
    this.store = store;
    this.memoryStore = memoryStore;
  }

  public enable(): void {
    if (!this.memoryStore.get("safeStorageAvailable")) {
      log.info("Refusing to enable LastFM Integration with reason: safeStorage unavailable");
      return;
    }

    if (this.isEnabled) {
      return;
    }
    this.isEnabled = true;

    this.lastfmDetails = this.getSettings();

    if (!this.currentSettings.sessionKey) {
      this.connect();
    }

    this.playerStateFunction = (state: PlayerState) => {
      this.updatePlayerState(state).catch((error: unknown) => log.error("Last.fm failed to follow playback", error));
    };
    playerStateStore.addEventListener(this.playerStateFunction);
  }

  public disable(): void {
    if (!this.isEnabled) {
      return;
    }

    if (this.playerStateFunction) playerStateStore.removeEventListener(this.playerStateFunction);
    this.isEnabled = false;

    this.cancelAuthFlow();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.pendingScrobbles = [];
    this.backoffMs = 0;
    this.backoffUntil = 0;
    this.play = null;
    this.possibleVideoIds = null;
  }

  private getSettings(): StoreSchema["lastfm"] {
    const decryptedValues = this.store.get("lastfm");

    if (decryptedValues.sessionKey) {
      try {
        decryptedValues.sessionKey = safeStorage.decryptString(Buffer.from(decryptedValues.sessionKey, "hex"));
      } catch (e) {
        decryptedValues.sessionKey = null;
        log.error(e);
      }
    }

    if (decryptedValues.token) {
      try {
        decryptedValues.token = safeStorage.decryptString(Buffer.from(decryptedValues.token, "hex"));
      } catch (e) {
        decryptedValues.token = null;
        log.error(e);
      }
    }

    return decryptedValues;
  }

  private saveSettings(): Promise<void> {
    return new Promise((resolve) => {
      this.persistSettings();
      resolve();
    });
  }

  private persistSettings(): void {
    try {
      if (this.currentSettings.sessionKey) {
        this.store.set("lastfm.sessionKey", safeStorage.encryptString(this.currentSettings.sessionKey).toString("hex"));
      }
      if (this.currentSettings.token) {
        this.store.set("lastfm.token", safeStorage.encryptString(this.currentSettings.token).toString("hex"));
      }
    } catch (error) {
      log.warn("index: operation failed", error);
    }
  }
}
