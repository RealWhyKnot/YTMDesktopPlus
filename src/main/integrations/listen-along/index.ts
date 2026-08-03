import { app, safeStorage } from "electron";
import Conf from "conf";
import log from "electron-log";
import type { Socket } from "socket.io-client";

import IIntegration from "../integration";
import MemoryStore from "../../memory-store";
import playerStateStore, { type PlayerState } from "../../player-state-store";
import { cueTrack, sendPlaybackCommand } from "../../playback";
import type { ListenAlongStatus, MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { ListenAlongError, connectRealtime, fetchState, pair, sampleFromRemoteState } from "./client";
import { FollowerEngine, type FollowerPhaseEvent } from "./follower-engine";

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_CONNECTION_ATTEMPTS = 30;

export default class ListenAlong implements IIntegration {
  private store: Conf<StoreSchema>;
  private memoryStore: MemoryStore<MemoryStoreSchema>;

  private enabled = false;
  private socket: Socket | null = null;
  private stateCallback: ((state: PlayerState) => void) | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionAttempts = 0;
  private oneWayMs = 0;

  private engine = new FollowerEngine({
    cueTrack: request => cueTrack(request),
    sendCommand: (command, value) => sendPlaybackCommand(command, value),
    onPhase: event => this.onEnginePhase(event),
    now: () => Date.now()
  });

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.store = store;
    this.memoryStore = memoryStore;
  }

  private setStatus(status: ListenAlongStatus, detail: string | null = null) {
    this.memoryStore.set("listenAlongStatus", status);
    this.memoryStore.set("listenAlongStatusDetail", detail);
  }

  private onEnginePhase(event: FollowerPhaseEvent) {
    if (!this.enabled) return;
    if (event.phase === "loading") {
      this.setStatus("loading");
      return;
    }
    if (event.phase === "suspended") {
      log.info(`Listen along suspended: ${event.reason}`);
      this.setStatus("suspended", event.reason);
      return;
    }
    // Only promote to synced from states that mean we are actually following;
    // never clobber connecting/failed/pairing.
    const status = this.memoryStore.get("listenAlongStatus");
    if (status === "connected" || status === "loading" || status === "synced" || status === "suspended") {
      this.setStatus("synced");
    }
  }

  private readToken() {
    const stored = this.store.get("integrations").listenAlongToken;
    if (!stored) return null;
    try {
      return safeStorage.decryptString(Buffer.from(stored, "hex"));
    } catch {
      return null;
    }
  }

  private target() {
    const integrations = this.store.get("integrations");
    return { host: integrations.listenAlongHost, port: integrations.listenAlongHostPort ?? 9863 };
  }

  public async startPairing(host: string, port: number) {
    this.memoryStore.set("listenAlongPairingError", null);
    this.memoryStore.set("listenAlongPairingCode", null);

    if (!this.memoryStore.get("safeStorageAvailable")) {
      this.memoryStore.set("listenAlongPairingError", "Encrypted storage is unavailable, so the host token cannot be saved");
      return false;
    }

    this.setStatus("pairing");
    try {
      const token = await pair(host, port, app.getVersion(), code => this.memoryStore.set("listenAlongPairingCode", code));
      this.store.set("integrations.listenAlongHost", host);
      this.store.set("integrations.listenAlongHostPort", port);
      this.store.set("integrations.listenAlongToken", safeStorage.encryptString(token).toString("hex"));
      this.memoryStore.set("listenAlongPairingCode", null);
      log.info(`Listen along paired with ${host}:${port}`);

      if (this.enabled) this.connect();
      return true;
    } catch (error) {
      const detail = error instanceof ListenAlongError ? error.detail : "Pairing failed";
      this.memoryStore.set("listenAlongPairingCode", null);
      this.memoryStore.set("listenAlongPairingError", detail);
      this.setStatus("failed", detail);
      log.info(`Listen along pairing failed: ${detail}`);
      return false;
    }
  }

  public unpair() {
    this.store.set("integrations.listenAlongToken", null);
    this.store.set("integrations.listenAlongHost", null);
    this.disconnect();
    this.setStatus(this.enabled ? "failed" : "disabled", this.enabled ? "Not paired with a host yet" : null);
  }

  public resume() {
    this.engine.resume();
  }

  private onRemoteState(state: Parameters<typeof sampleFromRemoteState>[0]) {
    this.engine.updateRemote(sampleFromRemoteState(state, Date.now() - this.oneWayMs));
  }

  private disconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.engine.clearRemote();
  }

  private scheduleReconnect() {
    if (!this.enabled) return;
    if (this.connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
      this.setStatus("failed", "Could not reach the host");
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.connectionAttempts, BACKOFF_MS.length - 1)];
    this.connectionAttempts++;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => this.connect(), delay);
  }

  private async connect() {
    if (!this.enabled) return;

    const { host, port } = this.target();
    const token = this.readToken();
    if (!host || !token) {
      this.setStatus("failed", "Not paired with a host yet");
      return;
    }

    this.setStatus("connecting");
    try {
      const seed = await fetchState(host, port, token);
      if (!this.enabled) return;
      if (seed) {
        this.oneWayMs = seed.oneWayMs;
        this.engine.updateRemote(seed.sample);
      }
    } catch (error) {
      const detail = error instanceof ListenAlongError ? error.detail : "Could not reach the host";
      // A revoked token will never start working again on its own.
      if (detail.includes("revoked")) {
        this.setStatus("failed", detail);
        return;
      }
      this.setStatus("connecting", detail);
      this.scheduleReconnect();
      return;
    }

    this.socket = connectRealtime(host, port, token, {
      onState: state => this.onRemoteState(state),
      onDisconnect: () => {
        if (!this.enabled) return;
        // Keep playing: silence is worse than drift.
        this.setStatus("connecting", "Lost contact with the host");
        this.scheduleReconnect();
      },
      onAuthFailure: () => {
        this.disconnect();
        this.setStatus("failed", "Host revoked access - pair again");
      }
    });

    this.socket.on("connect", () => {
      this.connectionAttempts = 0;
      this.setStatus("connected");
      this.engine.kick();
    });
  }

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.connectionAttempts = 0;

    this.stateCallback = state => this.engine.updateLocal(state);
    playerStateStore.addEventListener(this.stateCallback);

    void this.connect();
  }

  public disable(): void {
    this.enabled = false;
    this.disconnect();

    if (this.stateCallback) {
      playerStateStore.removeEventListener(this.stateCallback);
      this.stateCallback = null;
    }

    this.engine.reset();
    this.setStatus("disabled");
    this.memoryStore.set("listenAlongPairingCode", null);
    this.memoryStore.set("listenAlongPairingError", null);
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
