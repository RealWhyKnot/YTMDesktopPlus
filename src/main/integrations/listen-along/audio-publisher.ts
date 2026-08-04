import WebSocket from "ws";

import { VideoState, type PlayerState, type Thumbnail } from "../../player-state-store";
import {
  FATAL_AUDIO_ERRORS,
  audioUrlForRoom,
  encodeBatch,
  parseAudioServerFrame,
  type AudioClientFrame,
  type AudioServerFrame,
  type AudioStatus,
  type BatchPacket
} from "~shared/audio-protocol";
import { anchorFrameFrom, isMeaningfulChange, type RoomStateFrame } from "~shared/room-protocol";

// Publishes the host's captured audio to the relay's /audio channel while a
// room is being hosted. Track metadata and anchors ride the same socket so a
// browser listener needs nothing else; the desktop room protocol on /relay is
// untouched by any of this.

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_CONNECTION_ATTEMPTS = 30;
// Batches stop after a pause outlives a scrub; silence is not worth upload.
const PAUSE_GATE_MS = 5000;
// A socket this far behind drops batches rather than queueing them forever.
const MAX_BUFFERED_BYTES = 262_144;

export type AudioCredentials = { roomId: string; hostKey: string };

export type AudioCaptureStatus = {
  cfg?: { sr: number; ch: number; br: number };
  muted?: boolean;
  error?: string;
};

export type AudioTransportHandlers = {
  onOpen(): void;
  onFrame(frame: AudioServerFrame): void;
  onClose(): void;
};

export interface AudioTransport {
  connect(): void;
  sendText(frame: AudioClientFrame): void;
  sendBinary(data: Uint8Array): void;
  close(): void;
  readonly isOpen: boolean;
  readonly bufferedAmount: number;
}

export class AudioRelayClient implements AudioTransport {
  private socket: WebSocket | null = null;

  constructor(
    private readonly url: string,
    private readonly handlers: AudioTransportHandlers
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  get bufferedAmount(): number {
    return this.socket?.bufferedAmount ?? 0;
  }

  connect() {
    this.close();
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.on("open", () => this.handlers.onOpen());
    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const frame = parseAudioServerFrame(typeof data === "string" ? data : data.toString("utf8"));
      if (frame) this.handlers.onFrame(frame);
    });
    socket.on("close", () => {
      if (this.socket === socket) this.socket = null;
      this.handlers.onClose();
    });
    socket.on("error", () => {
      // The close event follows and carries the reconnect decision.
    });
  }

  sendText(frame: AudioClientFrame) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(frame));
  }

  sendBinary(data: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(data);
  }

  close() {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    socket.removeAllListeners();
    socket.on("error", () => {});
    socket.close();
  }
}

export type AudioPublisherDeps = {
  createTransport(url: string, handlers: AudioTransportHandlers): AudioTransport;
  startCapture(): void;
  stopCapture(): void;
  onUpdate(update: { streaming: boolean; webListeners: number }): void;
  now(): number;
  log(message: string, ...args: unknown[]): void;
};

function highestResThumbnail(thumbnails: Thumbnail[] | undefined): string | undefined {
  let best: Thumbnail | null = null;
  for (const thumbnail of thumbnails ?? []) {
    if (!best || thumbnail.width * thumbnail.height > best.width * best.height) best = thumbnail;
  }
  return best && best.url.startsWith("https://") ? best.url : undefined;
}

export class AudioPublisher {
  private creds: AudioCredentials | null = null;
  private transport: AudioTransport | null = null;
  private phase: "idle" | "connecting" | "ready" | "failed" = "idle";
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private seq = 0;
  private pendingDiscontinuity = false;
  private cfg: AudioCaptureStatus["cfg"] | null = null;
  private muted = false;
  private adPlaying = false;
  private sentStatus: AudioStatus | null = null;
  private lastPlayingAt = 0;
  private lastState: PlayerState | null = null;
  private metaVideoId: string | null = null;
  private metaHadFullMetadata = false;
  private lastSentAnchor: RoomStateFrame | null = null;
  private webListeners = 0;
  private streaming = false;

  constructor(private readonly deps: AudioPublisherDeps) {}

  /**
   * Follows the hosting state: credentials while a room is hosted with
   * streaming enabled, null otherwise. Safe to call on every snapshot.
   */
  setCredentials(creds: AudioCredentials | null) {
    if (creds === null) {
      if (this.creds !== null) this.stop();
      return;
    }
    if (this.creds && this.creds.roomId === creds.roomId && this.creds.hostKey === creds.hostKey) return;

    this.stop();
    this.creds = creds;
    this.phase = "connecting";
    this.deps.startCapture();
    this.dial();
  }

  handleChunks(packets: BatchPacket[]) {
    if (packets.length === 0) return;
    if (this.phase !== "ready" || !this.transport?.isOpen) return;

    const paused = this.deps.now() - this.lastPlayingAt > PAUSE_GATE_MS;
    if (this.adPlaying || paused || this.transport.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.pendingDiscontinuity = true;
      return;
    }

    let batch: Uint8Array;
    try {
      batch = encodeBatch(packets, this.seq++, { discontinuity: this.pendingDiscontinuity });
    } catch (error) {
      this.deps.log("audio publisher dropped an unencodable batch", error);
      return;
    }
    this.pendingDiscontinuity = false;
    this.transport.sendBinary(batch);
  }

  handleCaptureStatus(status: AudioCaptureStatus) {
    if (status.error !== undefined) {
      this.deps.log("audio capture failed", status.error);
      this.stop();
      return;
    }
    if (status.cfg) {
      this.cfg = status.cfg;
      this.sendCfg();
    }
    if (status.muted !== undefined) {
      this.muted = status.muted;
      this.sendStatus();
    }
  }

  updateLocalState(state: PlayerState) {
    this.lastState = state;
    if (state.trackState === VideoState.Playing) this.lastPlayingAt = this.deps.now();
    if (this.adPlaying !== state.adPlaying) {
      this.adPlaying = state.adPlaying;
      if (!state.adPlaying) this.pendingDiscontinuity = true;
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
    this.phase = "idle";
    this.attempts = 0;
    this.seq = 0;
    this.pendingDiscontinuity = false;
    this.sentStatus = null;
    this.metaVideoId = null;
    this.metaHadFullMetadata = false;
    this.lastSentAnchor = null;
    this.publishUpdate(false, 0);
  }

  private dial() {
    if (!this.creds) return;
    this.transport?.close();
    this.transport = this.deps.createTransport(audioUrlForRoom(this.creds.roomId), {
      onOpen: () => {
        if (this.creds) this.transport?.sendText({ t: "pub", r: this.creds.roomId, k: this.creds.hostKey });
      },
      onFrame: frame => this.onFrame(frame),
      onClose: () => this.onClose()
    });
    this.transport.connect();
  }

  private onFrame(frame: AudioServerFrame) {
    switch (frame.t) {
      case "ready": {
        this.attempts = 0;
        this.phase = "ready";
        this.pendingDiscontinuity = true;
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
        this.publishUpdate(this.streaming, frame.n);
        return;
      }
      case "e": {
        if (FATAL_AUDIO_ERRORS.includes(frame.m)) {
          this.deps.log("audio publisher refused by the relay", frame.m);
          this.phase = "failed";
          this.publishUpdate(false, 0);
        }
        return;
      }
    }
  }

  private onClose() {
    if (this.phase === "idle" || this.phase === "failed") return;
    this.phase = "connecting";
    this.publishUpdate(false, this.webListeners);
    if (this.attempts >= MAX_CONNECTION_ATTEMPTS) {
      this.deps.log("audio publisher gave up reconnecting");
      this.phase = "failed";
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)];
    this.attempts++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.dial(), delay);
  }

  private sendCfg() {
    if (this.phase !== "ready" || !this.cfg) return;
    this.transport?.sendText({ t: "cfg", codec: "opus", sr: this.cfg.sr, ch: this.cfg.ch, br: this.cfg.br });
  }

  private sendStatus() {
    if (this.phase !== "ready") return;
    const status: AudioStatus = this.adPlaying ? "ad" : this.muted ? "muted" : "live";
    if (status === this.sentStatus) return;
    this.sentStatus = status;
    this.transport?.sendText({ t: "status", s: status });
  }

  private sendMetaIfChanged(state: PlayerState) {
    const details = state.videoDetails;
    if (!details?.id || state.adPlaying) return;
    const changed = details.id !== this.metaVideoId;
    const metadataLanded = state.hasFullMetadata && !this.metaHadFullMetadata;
    this.metaHadFullMetadata = state.hasFullMetadata;
    if (!changed && !metadataLanded) return;
    this.metaVideoId = details.id;

    this.transport?.sendText({
      t: "meta",
      v: details.id,
      title: details.title || undefined,
      artist: details.author || undefined,
      album: details.album || undefined,
      coverUrl: highestResThumbnail(details.thumbnails),
      durS: Number.isFinite(details.durationSeconds) ? details.durationSeconds : undefined
    });
  }

  // Same rule the room anchor uses: only when a listener would notice.
  private sendAnchorIfChanged(state: PlayerState) {
    const videoId = state.videoDetails?.id;
    if (!videoId || state.adPlaying) return;
    const playing = state.trackState === VideoState.Playing;
    const paused = state.trackState === VideoState.Paused;
    if (!playing && !paused) return;

    const frame = anchorFrameFrom(videoId, state.videoProgress, playing, this.deps.now());
    if (!isMeaningfulChange(this.lastSentAnchor, frame)) return;
    this.lastSentAnchor = frame;
    this.transport?.sendText({ t: "anchor", a: frame.a, p: frame.p });
  }

  private publishUpdate(streaming: boolean, webListeners: number) {
    if (this.streaming === streaming && this.webListeners === webListeners) return;
    this.streaming = streaming;
    this.webListeners = webListeners;
    this.deps.onUpdate({ streaming, webListeners });
  }
}
