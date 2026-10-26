import EventEmitter from "events";
import { Socket } from "net";
import log from "electron-log";

export enum OPCode {
  HANDSHAKE = 0,
  FRAME = 1,
  CLOSE = 2,
  PING = 3,
  PONG = 4
}

export const FRAME_HEADER_BYTES = 8;
export const MAX_FRAME_BYTES = 1024 * 1024;

export default class IPCClient extends EventEmitter {
  private socket: Socket;
  private pending: Buffer = Buffer.alloc(0);

  constructor() {
    super();

    this.createSocket();
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
    this.socket = new Socket();
    this.socket.on("connect", () => {
      this.emit("connect");
    });
    this.socket.on("close", (hadError: boolean) => {
      this.emit("close", hadError);
    });
    this.socket.on("error", error => {
      if (this.listenerCount("error") > 0) this.emit("error", error);
      else log.warn("dipc: socket error", error);
    });
    this.socket.on("data", (chunk: Buffer) => this.receive(chunk));
  }

  public connect(ipcPath: string) {
    if (this.socket.destroyed) {
      this.createSocket();
    }
    this.socket.connect(ipcPath);
  }

  public send(data: unknown, op = OPCode.FRAME) {
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
      this.createSocket();
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
