import { utilityProcess, type MessagePortMain } from "electron";
import path from "path";
import type { PlayerState } from "~shared/addons/sdk";
import type { AudioCaptureStatus, AudioCredentials, UplinkState } from "../integrations/listen-along/audio-publisher";
import type { UplinkCommand, UplinkEvent } from "../services/audio-uplink";

const MAX_EXITS = 3;
const EXIT_WINDOW_MS = 30_000;

export type UplinkProcess = {
  postMessage(message: UplinkCommand, transfer?: MessagePortMain[]): void;
  on(event: "message", listener: (event: UplinkEvent) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  on(event: "error", listener: (type: string) => void): unknown;
};

export type AudioUplinkDeps = {
  fork(): UplinkProcess;
  connectMediaHost(send: (port: MessagePortMain) => void): void;
  setCapture(on: boolean): void;
  onUpdate(update: { streaming: boolean; webListeners: number }): void;
  log(message: string, ...args: unknown[]): void;
  now(): number;
};

export function forkAudioUplink(): UplinkProcess {
  return utilityProcess.fork(path.join(__dirname, "audio-uplink.js"), [], { serviceName: "Room audio uplink" });
}

export function slimState(state: PlayerState): UplinkState {
  const details = state.videoDetails;
  return {
    videoDetails: details && {
      id: details.id,
      title: details.title,
      author: details.author,
      album: details.album,
      thumbnails: details.thumbnails,
      durationSeconds: details.durationSeconds
    },
    trackState: state.trackState,
    videoProgress: state.videoProgress,
    adPlaying: state.adPlaying,
    hasFullMetadata: state.hasFullMetadata
  };
}

export class AudioUplink {
  private child: UplinkProcess | null = null;
  private creds: AudioCredentials | null = null;
  private state: UplinkState | null = null;
  private muted: boolean | undefined;
  private exits: number[] = [];

  constructor(private readonly deps: AudioUplinkDeps) {}

  setCredentials(creds: AudioCredentials | null) {
    this.creds = creds;
    if (!creds) this.exits = [];
    else if (!this.child && this.exits.length < MAX_EXITS) this.spawn();
    this.child?.postMessage({ t: "creds", creds });
  }

  updateLocalState(state: PlayerState) {
    this.state = slimState(state);
    this.child?.postMessage({ t: "state", state: this.state });
  }

  handleCaptureStatus(status: AudioCaptureStatus) {
    if (status.muted !== undefined) this.muted = status.muted;
    this.child?.postMessage({ t: "status", status });
  }

  private spawn() {
    const child = this.deps.fork();
    this.child = child;
    child.on("message", event => this.onEvent(event));
    child.on("exit", code => this.onExit(child, code));
    child.on("error", type => this.deps.log("Audio uplink process failed", type));
    if (this.state) child.postMessage({ t: "state", state: this.state });
    if (this.muted !== undefined) child.postMessage({ t: "status", status: { muted: this.muted } });
    this.deps.connectMediaHost(port => child.postMessage({ t: "port" }, [port]));
  }

  private onEvent(event: UplinkEvent) {
    switch (event.t) {
      case "capture":
        this.deps.setCapture(event.on);
        return;
      case "update":
        this.deps.onUpdate({ streaming: event.streaming, webListeners: event.webListeners });
        return;
      case "log":
        this.deps.log(event.message, ...event.args);
    }
  }

  private onExit(child: UplinkProcess, code: number) {
    if (this.child !== child) return;
    this.child = null;
    if (!this.creds) return;

    const now = this.deps.now();
    this.exits = [...this.exits.filter(at => now - at < EXIT_WINDOW_MS), now];
    if (this.exits.length >= MAX_EXITS) {
      this.deps.log(`Audio uplink exited ${MAX_EXITS} times within ${EXIT_WINDOW_MS / 1000}s, room audio stopped`, code);
      this.deps.setCapture(false);
      this.deps.onUpdate({ streaming: false, webListeners: 0 });
      return;
    }
    this.deps.log("Audio uplink exited, restarting it", code);
    this.spawn();
    this.child?.postMessage({ t: "creds", creds: this.creds });
  }
}
