import WebSocket from "ws";

import { RELAY_URL, encodeClientFrame, parseServerFrame, type RoomClientFrame, type RoomServerFrame } from "~shared/room-protocol";

// Thin transport over the relay websocket. Reconnect policy lives in the
// session; this only dials and frames.

export const LIVENESS_TIMEOUT_MS = 45_000;

export type RelayHandlers = {
  onOpen(): void;
  onFrame(frame: RoomServerFrame): void;
  onClose(detail?: string): void;
};

export type LiveSocket = Pick<WebSocket, "on" | "removeAllListeners" | "close" | "terminate" | "send" | "readyState" | "bufferedAmount">;

export type SocketFactory = (url: string) => LiveSocket;

export const openSocket: SocketFactory = url => new WebSocket(url);

export function describeClose(code: number, reason: Buffer, failure: string): string {
  const text = reason.toString("utf8");
  return [String(code), text, failure && `(${failure})`].filter(Boolean).join(" ");
}

export function watchLiveness(socket: LiveSocket, onSilent: () => void, timeoutMs = LIVENESS_TIMEOUT_MS): () => void {
  let timer: NodeJS.Timeout | null = null;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = () => {
    stop();
    timer = setTimeout(() => {
      timer = null;
      onSilent();
    }, timeoutMs);
  };
  socket.on("open", arm);
  socket.on("message", arm);
  socket.on("ping", arm);
  socket.on("pong", arm);
  socket.on("close", stop);
  arm();
  return stop;
}

export class RelayClient {
  private socket: LiveSocket | null = null;
  private stopWatch: (() => void) | null = null;

  constructor(
    private readonly handlers: RelayHandlers,
    private readonly url: string = RELAY_URL,
    private readonly createSocket: SocketFactory = openSocket
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect() {
    this.close();

    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.on("open", () => this.handlers.onOpen());
    socket.on("message", data => {
      const frame = parseServerFrame(typeof data === "string" ? data : data.toString("utf8"));
      if (frame) this.handlers.onFrame(frame);
    });
    let failure = "";
    socket.on("close", (code, reason) => {
      if (this.socket === socket) this.socket = null;
      this.handlers.onClose(describeClose(code, reason, failure));
    });
    socket.on("error", error => {
      failure = error.message;
    });
    this.stopWatch = watchLiveness(socket, () => {
      failure = `no traffic for ${LIVENESS_TIMEOUT_MS / 1000}s`;
      socket.terminate();
    });
  }

  send(frame: RoomClientFrame) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(encodeClientFrame(frame));
    }
  }

  close() {
    this.stopWatch?.();
    this.stopWatch = null;
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    socket.removeAllListeners();
    socket.on("error", () => {});
    socket.close();
  }
}
