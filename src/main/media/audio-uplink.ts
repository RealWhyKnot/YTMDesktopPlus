import { utilityProcess, type MessagePortMain } from "electron";
import path from "path";
import type { PlayerState } from "~shared/addons/sdk";
import type { AudioIssue } from "~shared/room-protocol";
import type { AudioCaptureStatus, AudioCredentials, AudioFault, UplinkState } from "../integrations/listen-along/audio-publisher";
import type { UplinkCommand, UplinkEvent } from "../services/audio-uplink";

const MAX_EXITS = 3;
const EXIT_WINDOW_MS = 30_000;
const IDLE_EXIT_MS = 5_000;
export const CAPTURE_RETRY_MS = [2_000, 5_000, 15_000, 30_000, 60_000];
export const MAX_CAPTURE_RETRIES = 8;
export const HEALTHY_STREAM_MS = 60_000;
export const RELAY_REARM_MS = 120_000;

export type UplinkProcess = {
  postMessage(message: UplinkCommand, transfer?: MessagePortMain[]): void;
  kill(): boolean;
  on(event: "message", listener: (event: UplinkEvent) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  on(event: "error", listener: (type: string) => void): unknown;
};

export type AudioUplinkDeps = {
  fork(): UplinkProcess;
  connectMediaHost(send: (port: MessagePortMain) => void): void;
  setCapture(on: boolean): void;
  onUpdate(update: { streaming: boolean; webListeners: number; issue: AudioIssue | null }): void;
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

function sameCreds(a: AudioCredentials | null, b: AudioCredentials | null) {
  if (!a || !b) return a === b;
  return a.roomId === b.roomId && a.hostKey === b.hostKey;
}

export class AudioUplink {
  private child: UplinkProcess | null = null;
  private creds: AudioCredentials | null = null;
  private state: UplinkState | null = null;
  private muted: boolean | undefined;
  private clockOffsetMs: number | null = null;
  private exits: number[] = [];
  private streaming = false;
  private webListeners = 0;
  private issue: AudioIssue | null = null;
  private liveSince: number | null = null;
  private captureFailures = 0;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: AudioUplinkDeps) {}

  setCredentials(creds: AudioCredentials | null) {
    if (sameCreds(this.creds, creds)) return;
    this.cancelRetry();
    this.captureFailures = 0;
    this.creds = creds;
    if (!creds) this.exits = [];
    else if (!this.child && this.exits.length < MAX_EXITS) this.spawn();
    this.child?.postMessage({ t: "creds", creds });
    if (!creds && this.child) this.retire(this.child);
    if (!creds || this.child) this.setIssue(null);
  }

  setClockOffset(offsetMs: number | null) {
    if (this.clockOffsetMs === offsetMs) return;
    this.clockOffsetMs = offsetMs;
    this.child?.postMessage({ t: "clock", offsetMs });
  }

  reconnectNow() {
    if (!this.creds) return;
    if (this.retryTimer) this.retryNow();
    else this.child?.postMessage({ t: "redial" });
  }

  rearm() {
    if (this.issue === "retrying") this.retryNow();
  }

  private retire(child: UplinkProcess) {
    setTimeout(() => {
      if (this.creds || this.child !== child) return;
      this.child = null;
      child.kill();
    }, IDLE_EXIT_MS);
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
    if (this.clockOffsetMs !== null) child.postMessage({ t: "clock", offsetMs: this.clockOffsetMs });
    this.deps.connectMediaHost(port => (this.child === child ? child.postMessage({ t: "port" }, [port]) : port.close()));
  }

  private onEvent(event: UplinkEvent) {
    switch (event.t) {
      case "capture":
        this.deps.setCapture(event.on);
        return;
      case "update":
        this.onStreamUpdate(event.streaming, event.webListeners);
        return;
      case "fault":
        this.onFault(event.fault);
        return;
      case "log":
        this.deps.log(event.message, ...event.args);
    }
  }

  private onStreamUpdate(streaming: boolean, webListeners: number) {
    const now = this.deps.now();
    if (streaming) this.liveSince ??= now;
    else {
      if (this.liveSince !== null && now - this.liveSince >= HEALTHY_STREAM_MS) this.captureFailures = 0;
      this.liveSince = null;
    }
    this.streaming = streaming;
    this.webListeners = webListeners;
    if (streaming && this.issue === "retrying") this.issue = null;
    this.emit();
  }

  private onFault(fault: AudioFault) {
    if (!this.creds) return;
    this.cancelRetry();
    if (fault === "outdated") {
      this.setIssue("outdated");
      return;
    }
    let delay = RELAY_REARM_MS;
    if (fault === "capture") {
      this.captureFailures++;
      if (this.captureFailures > MAX_CAPTURE_RETRIES) {
        this.deps.log(`Audio capture failed ${MAX_CAPTURE_RETRIES} times in a row, room audio stopped`);
        this.setIssue("stopped");
        return;
      }
      delay = CAPTURE_RETRY_MS[Math.min(this.captureFailures - 1, CAPTURE_RETRY_MS.length - 1)];
    }
    this.deps.log(`Room audio stopped (${fault}), trying again in ${delay / 1000}s`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryNow();
    }, delay);
    this.setIssue("retrying");
  }

  private retryNow() {
    this.cancelRetry();
    if (this.creds) this.child?.postMessage({ t: "creds", creds: this.creds });
  }

  private cancelRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setIssue(issue: AudioIssue | null) {
    if (this.issue === issue) return;
    this.issue = issue;
    this.emit();
  }

  private emit() {
    this.deps.onUpdate({ streaming: this.streaming, webListeners: this.webListeners, issue: this.issue });
  }

  private onExit(child: UplinkProcess, code: number) {
    if (this.child !== child) return;
    this.child = null;
    if (!this.creds) return;

    const now = this.deps.now();
    this.exits = [...this.exits.filter(at => now - at < EXIT_WINDOW_MS), now];
    if (this.exits.length >= MAX_EXITS) {
      this.deps.log(`Audio uplink exited ${MAX_EXITS} times within ${EXIT_WINDOW_MS / 1000}s, room audio stopped`, code);
      this.cancelRetry();
      this.deps.setCapture(false);
      this.streaming = false;
      this.webListeners = 0;
      this.liveSince = null;
      this.issue = "stopped";
      this.emit();
      return;
    }
    this.deps.log("Audio uplink exited, restarting it", code);
    this.spawn();
    this.child?.postMessage({ t: "creds", creds: this.creds });
  }
}
