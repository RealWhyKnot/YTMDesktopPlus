import { VideoState, type PlayerState } from "../../player-state-store";
import type { CueResult } from "../../playback/cue-track";
import type { RemoteCommandName } from "~shared/addons/sdk";
import {
  ROLE_LISTENER,
  anchorFrameFrom,
  buildRoomShareUrl,
  isFatalRelayError,
  isMeaningfulChange,
  positionMsFrom,
  type ControlAction,
  type RoomClientFrame,
  type RoomMemberView,
  type RoomPhase,
  type RoomRole,
  type RoomServerFrame,
  type RoomSnapshot,
  type RoomStateFrame
} from "~shared/room-protocol";
import { FollowerEngine, type FollowerPhaseEvent } from "./follower-engine";
import type { RelayHandlers } from "./relay-client";

// One relay room, hosted or joined. The host publishes anchors and applies
// controller intents against its own player; a listener feeds relayed anchors
// into the follower engine and otherwise behaves exactly like the LAN follow.

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000, 30000];
const MAX_CONNECTION_ATTEMPTS = 30;

export type { RoomPhase, RoomMemberView, RoomSnapshot };

export interface RelayTransport {
  connect(): void;
  send(frame: RoomClientFrame): void;
  close(): void;
  readonly isOpen: boolean;
}

export interface RoomSessionDeps {
  createClient(handlers: RelayHandlers): RelayTransport;
  cueTrack(request: { videoId: string; anchor: { kind: "anchor"; epochMs: number } | null }): Promise<CueResult>;
  sendCommand(command: RemoteCommandName, value?: unknown): void;
  publish(snapshot: RoomSnapshot): void;
  getPlayerState(): PlayerState;
  now(): number;
}

export class RoomSession {
  private mode: "idle" | "host" | "listen" = "idle";
  private phase: RoomPhase = "idle";
  private client: RelayTransport | null = null;
  private displayName: string | null = null;
  private roomId: string | null = null;
  private hostKey: string | null = null;
  private memberId: string | null = null;
  private role: RoomRole = ROLE_LISTENER;
  private hostName: string | null = null;
  private members: RoomMemberView[] = [];
  private listenerCount = 0;
  private error: string | null = null;
  private syncStatus: RoomSnapshot["syncStatus"] = null;
  private syncDetail: string | null = null;

  private lastLocal: PlayerState | null = null;
  private lastSentAnchor: RoomStateFrame | null = null;
  private audioStreaming = false;
  private webListenerCount = 0;
  private clockOffsetMs = 0;
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private intentionalClose = false;

  private engine: FollowerEngine;

  constructor(private readonly deps: RoomSessionDeps) {
    this.engine = new FollowerEngine({
      cueTrack: request => deps.cueTrack(request),
      sendCommand: (command, value) => deps.sendCommand(command, value),
      onPhase: event => this.onEnginePhase(event),
      now: () => deps.now()
    });
  }

  get snapshot(): RoomSnapshot {
    return {
      phase: this.phase,
      roomId: this.roomId,
      shareUrl: this.roomId ? buildRoomShareUrl(this.roomId) : null,
      memberId: this.memberId,
      isHost: this.mode === "host",
      role: this.role,
      hostName: this.hostName,
      members: this.members,
      listenerCount: this.listenerCount,
      error: this.error,
      syncStatus: this.syncStatus,
      syncDetail: this.syncDetail,
      audioStreaming: this.audioStreaming,
      webListenerCount: this.webListenerCount
    };
  }

  /** Present only while hosting an established room. Never leaves main. */
  get hostCredentials(): { roomId: string; hostKey: string } | null {
    if (this.mode !== "host" || !this.roomId || !this.hostKey) return null;
    return { roomId: this.roomId, hostKey: this.hostKey };
  }

  setAudioStreamState(streaming: boolean, webListeners: number) {
    if (this.audioStreaming === streaming && this.webListenerCount === webListeners) return;
    this.audioStreaming = streaming;
    this.webListenerCount = webListeners;
    this.publish();
  }

  // A null display name hosts anonymously; the wire simply omits it.
  host(displayName: string | null) {
    this.stopSession();
    this.mode = "host";
    this.displayName = displayName;
    this.hostName = displayName;
    this.phase = "connecting";
    this.publish();
    this.dial();
  }

  join(roomId: string, displayName: string) {
    this.stopSession();
    this.mode = "listen";
    this.displayName = displayName;
    this.roomId = roomId;
    this.phase = "connecting";
    this.publish();
    this.dial();
  }

  leave() {
    this.intentionalClose = true;
    try {
      this.client?.send({ t: "x" });
    } finally {
      this.stopSession();
      this.intentionalClose = false;
    }
    this.publish();
  }

  grant(memberId: string, role: RoomRole) {
    if (this.mode !== "host") return;
    this.client?.send({ t: "g", u: memberId, r: role });
  }

  control(action: ControlAction, value?: number | string) {
    if (this.mode !== "listen") return;
    if (action === "seek" && typeof value === "number") {
      this.client?.send({ t: "c", a: "seek", m: value });
    } else if (action === "track" && typeof value === "string") {
      this.client?.send({ t: "c", a: "track", v: value });
    } else if (action !== "seek" && action !== "track") {
      this.client?.send({ t: "c", a: action });
    }
  }

  resume() {
    this.engine.resume();
  }

  updateLocalState(state: PlayerState) {
    this.lastLocal = state;
    if (this.mode === "listen") this.engine.updateLocal(state);
    if (this.mode === "host" && this.phase === "hosting") this.publishAnchor();
  }

  destroy() {
    this.stopSession();
  }

  private onEnginePhase(event: FollowerPhaseEvent) {
    this.syncStatus = event.phase;
    this.syncDetail = event.phase === "suspended" ? event.reason : null;
    this.publish();
  }

  private publish() {
    this.deps.publish(this.snapshot);
  }

  private dial() {
    this.client?.close();
    this.client = this.deps.createClient({
      onOpen: () => this.onOpen(),
      onFrame: frame => this.onFrame(frame),
      onClose: () => this.onClose()
    });
    this.client.connect();
  }

  private onOpen() {
    if (this.mode === "host") {
      if (this.roomId && this.hostKey) {
        this.client?.send({ t: "h", r: this.roomId, k: this.hostKey, d: this.displayName ?? undefined });
      } else {
        this.client?.send({ t: "h", d: this.displayName ?? undefined });
      }
      return;
    }
    if (this.mode === "listen" && this.roomId) {
      this.client?.send({ t: "j", r: this.roomId, d: this.displayName ?? undefined });
    }
  }

  private onFrame(frame: RoomServerFrame) {
    switch (frame.t) {
      case "r": {
        this.attempts = 0;
        this.memberId = frame.u;
        this.clockOffsetMs = frame.c - this.deps.now();
        this.roomId = frame.r;
        this.error = null;
        if (this.mode === "host") {
          if (frame.k) this.hostKey = frame.k;
          this.phase = "hosting";
          this.lastSentAnchor = null;
          this.publishAnchor(true);
        } else {
          this.role = frame.role;
          this.phase = "listening";
          // The player may be idle with no state events flowing, so the engine
          // gets seeded with a local sample it can decide against.
          this.updateLocalState(this.deps.getPlayerState());
        }
        this.publish();
        return;
      }
      case "s": {
        if (this.mode !== "listen") return;
        const now = this.deps.now();
        this.clockOffsetMs = frame.c - now;
        this.engine.updateRemote({
          videoId: frame.v,
          durationSeconds: 0,
          progress: positionMsFrom(frame, now, this.clockOffsetMs) / 1000,
          trackState: frame.p === 1 ? VideoState.Playing : VideoState.Paused,
          adPlaying: false,
          asOfMs: now
        });
        return;
      }
      case "m": {
        this.members = frame.members.map(member => ({ id: member.u, name: member.d ?? null, role: member.r }));
        if (frame.h !== undefined) this.hostName = frame.h;
        this.publish();
        return;
      }
      case "n": {
        this.listenerCount = frame.n;
        this.publish();
        return;
      }
      case "role": {
        this.role = frame.r;
        this.publish();
        return;
      }
      case "c": {
        if (this.mode !== "host") return;
        this.applyIntent(frame);
        return;
      }
      case "e": {
        this.onRelayError(frame.m);
        return;
      }
    }
  }

  private applyIntent(frame: { a: ControlAction; m?: number; v?: string }) {
    switch (frame.a) {
      case "next":
        this.deps.sendCommand("next");
        return;
      case "prev":
        this.deps.sendCommand("previous");
        return;
      case "play":
        this.deps.sendCommand("play");
        return;
      case "pause":
        this.deps.sendCommand("pause");
        return;
      case "seek":
        if (frame.m !== undefined) this.deps.sendCommand("seekTo", frame.m);
        return;
      case "track":
        if (frame.v) void this.deps.cueTrack({ videoId: frame.v, anchor: null });
        return;
    }
  }

  // Publishes only when a listener would notice: track change, pause flip, or
  // a seek. A steady-playing track sends nothing at all.
  private publishAnchor(force = false) {
    const state = this.lastLocal;
    const videoId = state?.videoDetails?.id;
    if (!state || !videoId || state.adPlaying) return;

    const playing = state.trackState === VideoState.Playing;
    const paused = state.trackState === VideoState.Paused;
    if (!playing && !paused) return;

    const frame = anchorFrameFrom(videoId, state.videoProgress, playing, this.deps.now());
    if (force || isMeaningfulChange(this.lastSentAnchor, frame)) {
      this.client?.send(frame);
      this.lastSentAnchor = frame;
    }
  }

  private onRelayError(message: string) {
    if (isFatalRelayError(message)) {
      // The relay closes the socket after these; nothing to reconnect to.
      this.phase = "failed";
      this.error = message;
      this.stopClient();
      this.engine.clearRemote();
      this.publish();
      return;
    }
    if (message === "cannot reclaim room" || message === "reclaim that room on the node that owns it") {
      this.phase = "failed";
      this.error = "The room has expired";
      this.stopClient();
      this.publish();
      return;
    }
    this.error = message;
    this.publish();
  }

  private onClose() {
    if (this.intentionalClose || this.mode === "idle" || this.phase === "failed") return;
    this.phase = "connecting";
    this.publish();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.attempts >= MAX_CONNECTION_ATTEMPTS) {
      this.phase = "failed";
      this.error = "Could not reach the room service";
      this.publish();
      return;
    }
    const delay = BACKOFF_MS[Math.min(this.attempts, BACKOFF_MS.length - 1)];
    this.attempts++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.dial(), delay);
  }

  private stopClient() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.client?.close();
    this.client = null;
  }

  private stopSession() {
    this.stopClient();
    this.engine.reset();
    this.mode = "idle";
    this.phase = "idle";
    this.roomId = null;
    this.hostKey = null;
    this.memberId = null;
    this.role = ROLE_LISTENER;
    this.hostName = null;
    this.members = [];
    this.listenerCount = 0;
    this.error = null;
    this.syncStatus = null;
    this.syncDetail = null;
    this.lastSentAnchor = null;
    this.attempts = 0;
    this.audioStreaming = false;
    this.webListenerCount = 0;
  }
}
