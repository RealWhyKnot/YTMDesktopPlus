import EventEmitter from "events";
import { Socket } from "net";
import log from "electron-log";

export const OPCode = {
  HANDSHAKE: 0,
  [0]: "HANDSHAKE",
  FRAME: 1,
  [1]: "FRAME",
  CLOSE: 2,
  [2]: "CLOSE",
  PING: 3,
  [3]: "PING",
  PONG: 4,
  [4]: "PONG",
} as const;
export type OPCode = (typeof OPCode)[Exclude<keyof typeof OPCode, number>];

export const FRAME_HEADER_BYTES = 8;
export const MAX_FRAME_BYTES = 1024 * 1024;

export class IPCClient extends EventEmitter {
  private socket: Socket;
  private pending: Buffer = Buffer.alloc(0);

  constructor() {
    super();

    this.socket = this.createSocket();
  }

  private receive(chunk: Buffer) {
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);

    while (this.pending.length >= FRAME_HEADER_BYTES) {
      const op = this.pending.readInt32LE(0);
      const length = this.pending.readInt32LE(4);
      if (length < 0 || length > MAX_FRAME_BYTES) {
        log.warn(`dipc: dropping connection after a frame header claiming ${length} bytes`);
        this.pending = Buffer.alloc(0);
        this.socket.destroy();
        return;
      }
      if (this.pending.length < FRAME_HEADER_BYTES + length) return;

      const body = this.pending.toString("utf-8", FRAME_HEADER_BYTES, FRAME_HEADER_BYTES + length);
      this.pending = this.pending.subarray(FRAME_HEADER_BYTES + length);

      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        continue;
      }

      try {
        this.emit("data", op, json);
      } catch (error) {
        log.error("dipc: frame handler failed", error);
      }
    }
  }

  private createSocket() {
    this.pending = Buffer.alloc(0);
    const socket = new Socket();
    socket.on("connect", () => {
      this.emit("connect");
    });
    socket.on("close", (isHadError: boolean) => {
      this.emit("close", isHadError);
    });
    socket.on("error", (error) => {
      if (this.listenerCount("error") > 0) this.emit("error", error);
      else log.warn("dipc: socket error", error);
    });
    socket.on("data", (chunk: Buffer) => this.receive(chunk));
    return socket;
  }

  public connect(ipcPath: string) {
    if (this.socket.destroyed) {
      this.socket = this.createSocket();
    }
    this.socket.connect(ipcPath);
  }

  public send(data: unknown, op: OPCode = OPCode.FRAME) {
    const json = JSON.stringify(data);
    const length = Buffer.byteLength(json);
    const buffer = Buffer.alloc(8 + length);
    buffer.writeInt32LE(op, 0);
    buffer.writeInt32LE(length, 4);
    buffer.write(json, 8, length);

    if (this.socket.writable) {
      this.socket.write(buffer);
    } else {
      this.socket.end();
      this.socket = this.createSocket();
    }
  }

  public close() {
    if (!this.socket.closed) {
      this.send({}, OPCode.CLOSE);
      this.socket.end();
    }
  }

  public destroy() {
    this.removeAllListeners();
    this.socket.destroy();
  }
}
