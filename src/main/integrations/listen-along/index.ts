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
import { BREAKER_WINDOW_MS, decide } from "./sync-engine";
import type { Decision, Expectation, Sample, SyncPhase } from "./types";

// How long a command we issued stays attributable to us before a matching local
// change counts as the user reaching for the controls.
const EXPECTATION_TTL_MS = 1500;
// state-update fires on every player mutation, including queue changes carrying
// the full queue, so the decision loop runs on a floor rather than per message.
const DECISION_INTERVAL_MS = 200;
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

  private remote: Sample | null = null;
  private local: Sample | null = null;
  private previousLocal: Sample | null = null;
  private oneWayMs = 0;
  private phase: SyncPhase = "idle";
  private lastSeekAtMs: number | null = null;
  private lastRemoteUpdateMs: number | null = null;
  private seekTimestamps: number[] = [];
  private expectations: Expectation[] = [];
  private lastDecisionAtMs = 0;

  public provide(store: Conf<StoreSchema>, memoryStore: MemoryStore<MemoryStoreSchema>): void {
    this.store = store;
    this.memoryStore = memoryStore;
  }

  private setStatus(status: ListenAlongStatus, detail: string | null = null) {
    this.memoryStore.set("listenAlongStatus", status);
    this.memoryStore.set("listenAlongStatusDetail", detail);
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

  // Rejoining after the user took over is a deliberate action, so it clears the
  // breaker as well as the phase.
  public resume() {
    if (this.phase !== "suspended") return;
    this.seekTimestamps = [];
    this.lastSeekAtMs = null;
    this.phase = "synced";
    this.setStatus("synced");
    this.runDecision(true);
  }

  private sampleLocal(state: PlayerState): Sample {
    return {
      videoId: state.videoDetails?.id ?? null,
      durationSeconds: state.videoDetails?.durationSeconds ?? 0,
      progress: state.videoProgress,
      trackState: state.trackState,
      adPlaying: state.adPlaying,
      asOfMs: Date.now()
    };
  }

  private expect(kind: Expectation["kind"], target?: string | number) {
    const now = Date.now();
    this.expectations = this.expectations.filter(expectation => expectation.expiresAtMs > now);
    this.expectations.push({ kind, target, expiresAtMs: now + EXPECTATION_TTL_MS });
  }

  private apply(decision: Decision) {
    switch (decision.kind) {
      case "navigate": {
        this.expect("navigate", decision.videoId);
        this.setStatus("loading");
        // The track cue owns the navigate and the seek that follows it, and
        // supersedes itself when the host skips again.
        void cueTrack({
          videoId: decision.videoId,
          anchor: this.remote ? { kind: "anchor", epochMs: this.remote.asOfMs - this.remote.progress * 1000 } : null
        }).then(result => {
          if (this.phase === "loading") {
            this.phase = result === "no-view" ? "idle" : "synced";
            if (this.phase === "synced") this.setStatus("synced");
          }
        });
        break;
      }
      case "seek": {
        const now = Date.now();
        this.expect("seek", decision.seconds);
        this.lastSeekAtMs = now;
        this.seekTimestamps = [...this.seekTimestamps.filter(at => now - at < BREAKER_WINDOW_MS), now];
        this.send("seekTo", decision.seconds);
        break;
      }
      case "play": {
        this.expect("play");
        this.send("play");
        break;
      }
      case "pause": {
        this.expect("pause");
        this.send("pause");
        break;
      }
      case "suspend": {
        log.info(`Listen along suspended: ${decision.reason}`);
        this.setStatus("suspended", decision.reason);
        break;
      }
    }
  }

  private send(command: string, value?: unknown) {
    sendPlaybackCommand(command, value);
  }

  private runDecision(force = false) {
    if (!this.enabled) return;
    const now = Date.now();
    if (!force && now - this.lastDecisionAtMs < DECISION_INTERVAL_MS) return;
    this.lastDecisionAtMs = now;

    const result = decide({
      remote: this.remote,
      local: this.local,
      previousLocal: this.previousLocal,
      nowMs: now,
      phase: this.phase,
      lastSeekAtMs: this.lastSeekAtMs,
      lastRemoteUpdateMs: this.lastRemoteUpdateMs,
      seekTimestamps: this.seekTimestamps,
      expectations: this.expectations
    });

    const wasLoading = this.phase === "loading";
    this.phase = result.phase;
    for (const decision of result.decisions) this.apply(decision);

    if (!wasLoading && this.phase === "synced" && this.memoryStore.get("listenAlongStatus") === "connected") {
      this.setStatus("synced");
    }
  }

  private onRemoteState(state: Parameters<typeof sampleFromRemoteState>[0]) {
    this.lastRemoteUpdateMs = Date.now();
    this.remote = sampleFromRemoteState(state, this.lastRemoteUpdateMs - this.oneWayMs);
    this.runDecision();
  }

  private disconnect() {
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.reconnectTimeout = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
    this.remote = null;
    this.lastRemoteUpdateMs = null;
    this.phase = "idle";
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
        this.remote = seed.sample;
        this.lastRemoteUpdateMs = Date.now();
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
      this.runDecision(true);
    });
  }

  public enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.connectionAttempts = 0;
    this.phase = "idle";

    this.stateCallback = state => {
      this.previousLocal = this.local;
      this.local = this.sampleLocal(state);
      this.runDecision();
    };
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

    this.local = null;
    this.previousLocal = null;
    this.expectations = [];
    this.seekTimestamps = [];
    this.lastSeekAtMs = null;
    this.setStatus("disabled");
    this.memoryStore.set("listenAlongPairingCode", null);
    this.memoryStore.set("listenAlongPairingError", null);
  }

  public getYTMScripts(): { name: string; script: string }[] {
    return [];
  }
}
