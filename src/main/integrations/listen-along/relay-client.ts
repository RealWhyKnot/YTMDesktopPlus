import WebSocket from "ws";

import { RELAY_URL, encodeClientFrame, parseServerFrame, type RoomClientFrame, type RoomServerFrame } from "~shared/room-protocol";

// Thin transport over the relay websocket. Reconnect policy lives in the
// session; this only dials and frames.

export type RelayHandlers = {
  onOpen(): void;
  onFrame(frame: RoomServerFrame): void;
  onClose(): void;
};

export class RelayClient {
  private socket: WebSocket | null = null;

  constructor(
    private readonly handlers: RelayHandlers,
    private readonly url: string = RELAY_URL
  ) {}

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect() {
    this.close();

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.on("open", () => this.handlers.onOpen());
    socket.on("message", data => {
      const frame = parseServerFrame(typeof data === "string" ? data : data.toString("utf8"));
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

  send(frame: RoomClientFrame) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(encodeClientFrame(frame));
    }
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
