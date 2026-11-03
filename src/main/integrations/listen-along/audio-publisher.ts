import { socketText } from "~shared/socket-text";
import WebSocket from "ws";

import { VideoState, type PlayerState, type Thumbnail, type VideoDetails } from "~shared/addons/sdk";
import {
  AUDIO_PROTOCOL_VERSION,
  FATAL_AUDIO_ERRORS,
  audioUrlForRoom,
  encodeBatch,
  isCoverUrl,
  parseAudioServerFrame,
  sanitizeMetaText,
  type AudioClientFrame,
  type AudioServerFrame,
  type AudioStatus,
  type BatchPacket,
} from "~shared/audio-protocol";
import { ClockOffsetEstimator, anchorFrameFrom, isMeaningfulChange, type RoomStateFrame } from "~shared/room-protocol";
import { LIVENESS_TIMEOUT_MS, describeClose, openSocket, watchLiveness, type LiveSocket, type SocketFactory } from "./relay-client";

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_CONNECTION_ATTEMPTS = 30;

const PAUSE_GATE_MS = 5000;

export const MAX_BUFFERED_BYTES = 32_768;
export const HEALTHY_CONNECTION_MS = 30_000;
export const TEXT_FRAMES_PER_SECOND = 10;
export const TEXT_FRAME_BURST = 20;
export const TEXT_BYTES_PER_SECOND = 8192;

export type AudioCredentials = { roomId: string; hostKey: string };

export type AudioFault = "capture" | "relay" | "refused" | "outdated";

export type UplinkState = Pick<PlayerState, "trackState" | "videoProgress" | "adPlaying" | "hasFullMetadata"> & {
  videoDetails: Pick<VideoDetails, "id" | "title" | "author" | "album" | "thumbnails" | "durationSeconds"> | null;
};

export type AudioCaptureStatus = {
  cfg?: { sr: number; ch: number; br: number };
  muted?: boolean;
  error?: string;
};

export type AudioTransportHandlers = {
  onOpen(): void;
  onFrame(frame: AudioServerFrame): void;
  onClose(detail?: string): void;
};

export type AudioTransport = {
  connect(): void;
  sendText(frame: AudioClientFrame): void;
  sendBinary(data: Uint8Array): void;
  close(): void;
  readonly isOpen: boolean;
  readonly bufferedAmount: number;
};

export class AudioRelayClient implements AudioTransport {
  private socket: LiveSocket | null = null;
  private stopWatch: (() => void) | null = null;

  private readonly url: string;
  private readonly handlers: AudioTransportHandlers;
  private readonly createSocket: SocketFactory;
  constructor(url: string, handlers: AudioTransportHandlers, createSocket: SocketFactory = openSocket) {
    this.url = url;
    this.handlers = handlers;
    this.createSocket = createSocket;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get bufferedAmount(): number {
    return this.socket?.bufferedAmount ?? 0;
  }

  connect() {
    this.close();
    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.on("open", () => this.handlers.onOpen());
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const frame = parseAudioServerFrame(socketText(data));
      if (frame) this.handlers.onFrame(frame);
    });
    let failure = "";
    socket.on("close", (code, reason) => {
      if (this.socket === socket) this.socket = null;
      this.handlers.onClose(describeClose(code, reason, failure));
    });
    socket.on("error", (error) => {
      failure = error.message;
    });
    this.stopWatch = watchLiveness(socket, () => {
      failure = `no traffic for ${LIVENESS_TIMEOUT_MS / 1000}s`;
      socket.terminate();
    });
  }

  sendText(frame: AudioClientFrame) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  sendBinary(data: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data);
  }

  close() {
    this.stopWatch?.();
    this.stopWatch = null;
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    socket.removeAllListeners();
    socket.on("error", () => {
      return undefined;
    });
    socket.close();
  }
}

export type AudioPublisherDeps = {
  createTransport(url: string, handlers: AudioTransportHandlers): AudioTransport;
  startCapture(): void;
  stopCapture(): void;
  onUpdate(update: { streaming: boolean; webListeners: number }): void;
  onFault?(fault: AudioFault): void;
  now(): number;
  log(message: string, ...args: unknown[]): void;
};

function highestResThumbnail(thumbnails: Thumbnail[] | undefined): string | undefined {
  let best: Thumbnail | null = null;
  for (const thumbnail of thumbnails ?? []) {
    if (!isCoverUrl(thumbnail.url)) continue;
    if (!best || thumbnail.width * thumbnail.height > best.width * best.height) best = thumbnail;
  }
  return best?.url;
}

export class AudioPublisher {
  private creds: AudioCredentials | null = null;
  private transport: AudioTransport | null = null;
  private phase: "idle" | "connecting" | "ready" | "failed" = "idle";
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private seq = 0;
  private isPendingDiscontinuity = false;
  private cfg: AudioCaptureStatus["cfg"] | null = null;
  private isMuted = false;
  private isAdPlaying = false;
  private sentStatus: AudioStatus | null = null;
  private pausedSince: number | null = null;
  private lastState: UplinkState | null = null;
  private metaVideoId: string | null = null;
  private isMetaHadFullMetadata = false;
  private lastSentAnchor: RoomStateFrame | null = null;
  private webListeners = 0;
  private isStreaming = false;
  private fault: AudioFault | null = null;
  private readyAt: number | null = null;
  private pubSentAt: number | null = null;
  private serverVersion: number | null = null;
  private relayClockOffsetMs: number | null = null;
  private readonly audioClock = new ClockOffsetEstimator();
  private textTokens = TEXT_FRAME_BURST;
  private textBytes = TEXT_BYTES_PER_SECOND;
  private textRefilledAt = 0;
  private readonly queuedText = new Map<AudioClientFrame["t"], AudioClientFrame>();
  private textTimer: NodeJS.Timeout | null = null;

  private readonly deps: AudioPublisherDeps;
  constructor(deps: AudioPublisherDeps) {
    this.deps = deps;
  }

  setCredentials(creds: AudioCredentials | null) {
    if (creds === null) {
      if (this.creds !== null) this.stop();
      return;
    }
    if (this.creds?.roomId === creds.roomId && this.creds.hostKey === creds.hostKey) {
      if (this.phase === "failed" && this.fault !== "outdated") this.start(this.creds);
      return;
    }

    this.stop();
    this.start(creds);
  }

  setClockOffset(offsetMs: number | null) {
    this.relayClockOffsetMs = offsetMs;
  }

  redial() {
    if (!this.creds || this.phase === "idle" || this.phase === "failed") return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.transport?.close();
    this.transport = null;
    this.readyAt = null;
    this.phase = "connecting";
    this.publishUpdate(false, this.webListeners);
    this.dial();
  }

  private start(creds: AudioCredentials) {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.creds = creds;
    this.fault = null;
    this.attempts = 0;
    this.readyAt = null;
    this.phase = "connecting";
    this.deps.startCapture();
    this.dial();
  }

  handleChunks(packets: BatchPacket[]) {
    if (packets.length === 0) return;
    if (this.phase !== "ready" || !this.transport?.isOpen) return;

    const isPaused = this.pausedSince !== null && this.deps.now() - this.pausedSince > PAUSE_GATE_MS;
    if (isPaused || this.transport.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.isPendingDiscontinuity = true;
      return;
    }

    let batch: Uint8Array;
    try {
      batch = encodeBatch(packets, this.seq++, { discontinuity: this.isPendingDiscontinuity });
    } catch (error) {
      this.deps.log("audio publisher dropped an unencodable batch", error);
      return;
    }
    this.isPendingDiscontinuity = false;
    this.transport.sendBinary(batch);
  }

  handleCaptureStatus(status: AudioCaptureStatus) {
    if (status.error !== undefined) {
      if (this.creds && this.phase !== "failed") this.fail("capture", "audio capture failed", status.error);
      else this.deps.log("audio capture failed", status.error);
      return;
    }
    if (status.cfg) {
      this.cfg = status.cfg;
      this.sendCfg();
    }
    if (status.muted !== undefined) {
      this.isMuted = status.muted;
      this.sendStatus();
    }
  }

  updateLocalState(state: UplinkState) {
    this.lastState = state;
    if (state.trackState !== VideoState.Paused && state.trackState !== VideoState.Unknown) this.pausedSince = null;
    else this.pausedSince ??= this.deps.now();
    if (this.isAdPlaying !== state.adPlaying) {
      this.isAdPlaying = state.adPlaying;
      if (!state.adPlaying) this.isPendingDiscontinuity = true;
      this.sendStatus();
    }
    if (this.phase !== "ready") return;
    this.sendMetaIfChanged(state);
    this.sendAnchorIfChanged(state);
  }

  stop() {
    this.creds = null;
    this.deps.stopCapture();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.transport?.close();
    this.transport = null;
    this.resetText();
    this.phase = "idle";
    this.fault = null;
    this.attempts = 0;
    this.readyAt = null;
    this.serverVersion = null;
    this.audioClock.reset();
    this.seq = 0;
    this.isPendingDiscontinuity = false;
    this.sentStatus = null;
    this.metaVideoId = null;
    this.isMetaHadFullMetadata = false;
    this.lastSentAnchor = null;
    this.publishUpdate(false, 0);
  }

  private fail(fault: AudioFault, message: string, ...args: unknown[]) {
    this.deps.log(message, ...args);
    this.phase = "failed";
    this.fault = fault;
    this.readyAt = null;
    this.deps.stopCapture();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.transport?.close();
    this.transport = null;
    this.resetText();
    this.publishUpdate(false, 0);
    this.deps.onFault?.(fault);
  }

  private dial() {
    if (!this.creds) return;
    this.transport?.close();
    this.resetText();
    this.transport = this.deps.createTransport(audioUrlForRoom(this.creds.roomId), {
      onOpen: () => {
        if (!this.creds) return;
        this.pubSentAt = this.deps.now();
        this.sendText({ t: "pub", r: this.creds.roomId, k: this.creds.hostKey });
      },
      onFrame: (frame) => this.onFrame(frame),
      onClose: (detail) => this.onClose(detail),
    });
    this.transport.connect();
  }

  private onFrame(frame: AudioServerFrame) {
    switch (frame.t) {
      case "ready": {
        const now = this.deps.now();
        if (frame.c !== undefined) this.audioClock.add(frame.c, this.pubSentAt ?? now, now);
        if (frame.v !== undefined) this.serverVersion = frame.v;
        this.readyAt = now;
        this.phase = "ready";
        this.isPendingDiscontinuity = true;
        this.sendCfg();
        this.sentStatus = null;
        this.metaVideoId = null;
        this.lastSentAnchor = null;
        if (this.lastState) {
          this.sendMetaIfChanged(this.lastState);
          this.sendAnchorIfChanged(this.lastState);
        }
        this.sendStatus();
        this.publishUpdate(true, frame.n ?? this.webListeners);
        return;
      }
      case "n": {
        this.publishUpdate(this.isStreaming, frame.n);
        return;
      }
      case "e": {
        if (FATAL_AUDIO_ERRORS.includes(frame.m)) this.fail("refused", "audio publisher refused by the relay", frame.m);
        else if (frame.m === "bad frame" && this.serverVersion !== null && this.serverVersion > AUDIO_PROTOCOL_VERSION) {
          this.fail("outdated", "audio publisher is older than the relay", this.serverVersion);
        }
        return;
      }
    }
  }

  private onClose(detail?: string) {
    if (this.phase === "idle" || this.phase === "failed") return;
    this.deps.log("audio publisher connection closed", detail ?? "unknown");
    if (this.readyAt !== null && this.deps.now() - this.readyAt >= HEALTHY_CONNECTION_MS) this.attempts = 0;
    this.readyAt = null;
    this.phase = "connecting";
    this.publishUpdate(false, this.webListeners);
    if (this.attempts >= MAX_CONNECTION_ATTEMPTS) {
      this.fail("relay", "audio publisher gave up reconnecting");
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)];
    this.attempts++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.dial(), delay);
  }

  private sendCfg() {
    if (this.phase !== "ready" || !this.cfg) return;
    this.sendText({ t: "cfg", codec: "opus", sr: this.cfg.sr, ch: this.cfg.ch, br: this.cfg.br });
  }

  private sendStatus() {
    if (this.phase !== "ready") return;
    const status: AudioStatus = this.isAdPlaying ? "ad" : this.isMuted ? "muted" : "live";
    if (status === this.sentStatus) return;
    this.sentStatus = status;
    this.sendText({ t: "status", s: status });
  }

  private sendMetaIfChanged(state: UplinkState) {
    const details = state.videoDetails;
    if (!details?.id || state.adPlaying) return;
    const isChanged = details.id !== this.metaVideoId;
    const isMetadataLanded = state.hasFullMetadata && !this.isMetaHadFullMetadata;
    this.isMetaHadFullMetadata = state.hasFullMetadata;
    if (!isChanged && !isMetadataLanded) return;
    this.metaVideoId = details.id;

    this.sendText({
      t: "meta",
      v: details.id,
      title: sanitizeMetaText(details.title),
      artist: sanitizeMetaText(details.author),
      album: sanitizeMetaText(details.album),
      coverUrl: highestResThumbnail(details.thumbnails),
      durS: Number.isFinite(details.durationSeconds) ? details.durationSeconds : undefined,
    });
  }

  private sendAnchorIfChanged(state: UplinkState) {
    const videoId = state.videoDetails?.id;
    if (!videoId || state.adPlaying) return;
    const isPlaying = state.trackState === VideoState.Playing;
    const isPaused = state.trackState === VideoState.Paused;
    if (!isPlaying && !isPaused) return;

    const frame = anchorFrameFrom(videoId, state.videoProgress, isPlaying, this.deps.now() + this.serverClockOffsetMs());
    if (!isMeaningfulChange(this.lastSentAnchor, frame)) return;
    this.lastSentAnchor = frame;
    this.sendText({ t: "anchor", a: frame.a, p: frame.p });
  }

  private sendText(frame: AudioClientFrame) {
    if (!this.transport) return;
    this.queuedText.delete(frame.t);
    this.queuedText.set(frame.t, frame);
    this.flushText();
  }

  private flushText() {
    const now = this.deps.now();
    const elapsed = Math.max(0, now - this.textRefilledAt);
    this.textRefilledAt = now;
    this.textTokens = Math.min(TEXT_FRAME_BURST, this.textTokens + (elapsed * TEXT_FRAMES_PER_SECOND) / 1000);
    this.textBytes = Math.min(TEXT_BYTES_PER_SECOND, this.textBytes + (elapsed * TEXT_BYTES_PER_SECOND) / 1000);
    for (const [kind, frame] of this.queuedText) {
      const bytes = Buffer.byteLength(JSON.stringify(frame));
      if (this.textTokens < 1 || this.textBytes < bytes) break;
      this.textTokens -= 1;
      this.textBytes -= bytes;
      this.queuedText.delete(kind);
      this.transport?.sendText(frame);
    }
    if (this.queuedText.size > 0 && !this.textTimer) {
      this.textTimer = setTimeout(() => {
        this.textTimer = null;
        this.flushText();
      }, 1000 / TEXT_FRAMES_PER_SECOND);
    }
  }

  private resetText() {
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = null;
    this.queuedText.clear();
    this.textTokens = TEXT_FRAME_BURST;
    this.textBytes = TEXT_BYTES_PER_SECOND;
    this.textRefilledAt = this.deps.now();
  }

  private serverClockOffsetMs(): number {
    return this.audioClock.offsetMs ?? this.relayClockOffsetMs ?? 0;
  }

  private publishUpdate(isStreaming: boolean, webListeners: number) {
    if (this.isStreaming === isStreaming && this.webListeners === webListeners) return;
    this.isStreaming = isStreaming;
    this.webListeners = webListeners;
    this.deps.onUpdate({ streaming: isStreaming, webListeners });
  }
}
