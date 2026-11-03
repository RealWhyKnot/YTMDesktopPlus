import { app, safeStorage } from "electron";
import log from "electron-log";
import type { Socket } from "socket.io-client";

import type { Integration } from "../integration";
import { playerStateStore, type PlayerState } from "../../player-state-store";
import { cancelCue, cueTrack, sendPlaybackCommand } from "../../playback";
import type { ListenAlongStatus, MemoryStoreSchema, StoreSchema } from "~shared/store/schema";
import { ListenAlongError, connectRealtime, fetchState, pair, sampleFromRemoteState } from "./client";
import { FollowerEngine, type FollowerPhaseEvent } from "./follower-engine";

type ListenAlongStore = {
  get(key: "integrations"): Pick<StoreSchema["integrations"], "listenAlongHost" | "listenAlongHostPort" | "listenAlongToken">;
  set(key: string, value: unknown): void;
};

type ListenAlongMemory = {
  get(key: keyof MemoryStoreSchema): unknown;
  set(key: keyof MemoryStoreSchema, value: unknown): void;
};

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_CONNECTION_ATTEMPTS = 30;

export class ListenAlong implements Integration {
  private storeValue: ListenAlongStore | undefined;
  private get store(): ListenAlongStore {
    const value = this.storeValue;
    if (value === undefined) throw new Error("Integration store has not been provided");
    return value;
  }
  private set store(value: ListenAlongStore) {
    this.storeValue = value;
  }
  private memoryStoreValue: ListenAlongMemory | undefined;
  private get memoryStore(): ListenAlongMemory {
    const value = this.memoryStoreValue;
    if (value === undefined) throw new Error("Integration memoryStore has not been provided");
    return value;
  }
  private set memoryStore(value: ListenAlongMemory) {
    this.memoryStoreValue = value;
  }

  private isEnabled = false;
  private socket: Socket | null = null;
  private stateCallback: ((state: PlayerState) => void) | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionAttempts = 0;
  private oneWayMs = 0;
  private connectGeneration = 0;

  private engine = new FollowerEngine({
    cueTrack: (request) => cueTrack(request),
    sendCommand: (command, value) => sendPlaybackCommand(command, value),
    onPhase: (event) => this.onEnginePhase(event),
    now: () => Date.now(),
    cancelCue: () => cancelCue(),
  });

  public provide(store: ListenAlongStore, memoryStore: ListenAlongMemory): void {
    this.store = store;
    this.memoryStore = memoryStore;
  }

  private setStatus(status: ListenAlongStatus, detail: string | null = null) {
    this.memoryStore.set("listenAlongStatus", status);
    this.memoryStore.set("listenAlongStatusDetail", detail);
  }

  private onEnginePhase(event: FollowerPhaseEvent) {
    if (!this.isEnabled) return;
    if (event.phase === "loading") {
      this.setStatus("loading");
      return;
    }
    if (event.phase === "suspended") {
      log.info(`Listen along suspended: ${event.reason}`);
      this.setStatus("suspended", event.reason);
      return;
    }

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
    const integrations: Partial<StoreSchema["integrations"]> = this.store.get("integrations");
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
      const token = await pair(host, port, app.getVersion(), (code) => this.memoryStore.set("listenAlongPairingCode", code));
      this.store.set("integrations.listenAlongHost", host);
      this.store.set("integrations.listenAlongHostPort", port);
      this.store.set("integrations.listenAlongToken", safeStorage.encryptString(token).toString("hex"));
      this.memoryStore.set("listenAlongPairingCode", null);
      log.info(`Listen along paired with ${host}:${port}`);

      if (this.isEnabled) void this.connect().catch((error: unknown) => log.warn("startPairing failed", error));
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
    this.setStatus(this.isEnabled ? "failed" : "disabled", this.isEnabled ? "Not paired with a host yet" : null);
  }

  public resume() {
    this.engine.resume();
  }

  private onRemoteState(state: Parameters<typeof sampleFromRemoteState>[0]) {
    this.engine.updateRemote(sampleFromRemoteState(state, Date.now() - this.oneWayMs));
  }

  private closeSocket() {
    if (!this.socket) return;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
  }

  private disconnect() {
    this.connectGeneration++;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
    this.closeSocket();
    this.engine.clearRemote();
  }

  private scheduleReconnect() {
    if (!this.isEnabled) return;
    if (this.connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
      this.setStatus("failed", "Could not reach the host");
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.connectionAttempts, BACKOFF_MS.length - 1)];
    this.connectionAttempts++;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = setTimeout(() => {
      void this.connect().catch((error: unknown) => log.warn("Listen along could not reconnect", error));
    }, delay);
  }

  private async connect() {
    if (!this.isEnabled) return;
    const generation = ++this.connectGeneration;
    const current = () => this.isEnabled && generation === this.connectGeneration;
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
    this.closeSocket();

    const { host, port } = this.target();
    const token = this.readToken();
    if (!host || !token) {
      this.setStatus("failed", "Not paired with a host yet");
      return;
    }

    this.setStatus("connecting");
    try {
      const seed = await fetchState(host, port, token);
      if (!current()) return;
      if (seed) {
        this.oneWayMs = seed.oneWayMs;
        this.engine.updateRemote(seed.sample);
      }
    } catch (error) {
      if (!current()) return;
      const detail = error instanceof ListenAlongError ? error.detail : "Could not reach the host";

      if (detail.includes("revoked")) {
        this.setStatus("failed", detail);
        return;
      }
      this.setStatus("connecting", detail);
      this.scheduleReconnect();
      return;
    }

    this.socket = connectRealtime(host, port, token, {
      onState: (state) => {
        if (current()) this.onRemoteState(state);
      },
      onDisconnect: () => {
        if (!current()) return;

        this.setStatus("connecting", "Lost contact with the host");
        this.scheduleReconnect();
      },
      onAuthFailure: () => {
        if (!current()) return;
        this.disconnect();
        this.setStatus("failed", "The host revoked access. Pair again.");
      },
    });

    this.socket.on("connect", () => {
      if (!current()) return;
      this.connectionAttempts = 0;
      this.setStatus("connected");
      this.engine.kick();
    });
  }

  public enable(): void {
    if (this.isEnabled) return;
    this.isEnabled = true;
    this.connectionAttempts = 0;

    this.stateCallback = (state) => this.engine.updateLocal(state);
    playerStateStore.addEventListener(this.stateCallback);

    void this.connect().catch((error: unknown) => log.warn("enable failed", error));
  }

  public disable(): void {
    this.isEnabled = false;
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
}
