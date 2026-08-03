import WebSocket from "ws";
import type { IncomingMessage } from "node:http";

import { RELAY_URL, encodeClientFrame, parseServerFrame, type RoomClientFrame, type RoomServerFrame } from "~shared/room-protocol";

// Thin transport over the relay websocket. Reconnect policy lives in the
// session; this only dials, frames, and remembers which node the edge picked.
//
// The edge pins a client to one node with a cookie so a reconnect lands where
// the room lives. A reclaim on the wrong node is refused, so the cookie is
// echoed back and the node is also pinned explicitly via the query parameter
// the edge honours.

export type RelayHandlers = {
  onOpen(): void;
  onFrame(frame: RoomServerFrame): void;
  onClose(): void;
};

export const AFFINITY_COOKIE = "ytmdp_node";
export const AFFINITY_QUERY = "ytmdpedge";

export function nodeIdFromSetCookie(headers: string[] | undefined): string | null {
  for (const header of headers ?? []) {
    const match = new RegExp(`(?:^|;\\s*)${AFFINITY_COOKIE}=([^;]+)`).exec(header);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

export class RelayClient {
  private socket: WebSocket | null = null;
  private nodeId: string | null = null;

  constructor(
    private readonly handlers: RelayHandlers,
    private readonly url: string = RELAY_URL
  ) {}

  get pinnedNode(): string | null {
    return this.nodeId;
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect() {
    this.close();

    const target = this.nodeId ? `${this.url}?${AFFINITY_QUERY}=${encodeURIComponent(this.nodeId)}` : this.url;
    const headers: Record<string, string> = {};
    if (this.nodeId) headers.cookie = `${AFFINITY_COOKIE}=${encodeURIComponent(this.nodeId)}`;

    const socket = new WebSocket(target, { headers });
    this.socket = socket;

    socket.on("upgrade", (response: IncomingMessage) => {
      const node = nodeIdFromSetCookie(response.headers["set-cookie"]);
      if (node) this.nodeId = node;
    });
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
