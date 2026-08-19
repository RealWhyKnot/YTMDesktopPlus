import EventEmitter from "events";
import IPCClient, { OPCode } from "./ipc";
import { DiscordActivity } from "./types";
import { randomUUID } from "crypto";
import log from "electron-log";
import { existsSync, statSync } from "node:fs";

function directoryExists(dirPath: string): boolean {
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

const IPC_ID_COUNT = 10;

// A packaged discord puts its socket in its own runtime dir rather than the
// shared one, and each packaging format picks a different dir. The flatpak one
// is only reachable at all because of the matching --filesystem in
// forge.config.ts.
export function getIPCPaths(): string[] {
  const ids = Array.from({ length: IPC_ID_COUNT }, (_unused, id) => id);

  if (process.platform === "win32") {
    return ids.map(id => `\\\\?\\pipe\\discord-ipc-${id}`);
  }

  const dirtyPrefix = process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp";
  const prefix = dirtyPrefix.replace(/\/$/, "");
  const dirs = [prefix, `${prefix}/snap.discord`, `${prefix}/app/com.discordapp.Discord`].filter(directoryExists);

  // Id-major, so discord-ipc-0 is tried across every layout before ipc-1.
  return ids.flatMap(id => dirs.map(dir => `${dir}/discord-ipc-${id}`));
}

export default class DiscordClient extends EventEmitter {
  private clientId: string | null = null;
  private connectionPromise: Promise<void> | null = null;
  private ipcClient = new IPCClient();
  private connected = false;

  constructor(clientId: string) {
    super();

    this.clientId = clientId;
  }

  public connect() {
    if (this.connectionPromise) return this.connectionPromise;
    this.ipcClient.removeAllListeners();

    // Promise chaining is OK here, we're looping through different IPC paths and seeing which one works
    // eslint-disable-next-line no-async-promise-executor
    this.connectionPromise = new Promise(async (resolve, reject) => {
      const paths = getIPCPaths();
      log.debug(`dipc: initiated connection loop over ${paths.length} candidate paths`);
      let index = 0;
      while (index < paths.length) {
        try {
          await new Promise<void>((ipcResolve, ipcReject) => {
            const ipcPath = paths[index];
            log.debug("dipc: connecting to discord at", ipcPath);
            this.ipcClient.once("close", () => {
              this.ipcClient.removeAllListeners();
              log.debug("dipc: failed to connect to discord at", ipcPath);
              ipcReject();
            });
            this.ipcClient.once("error", error => {
              log.error("dipc: socket error connecting to discord", error);
            });
            this.ipcClient.once("connect", () => {
              log.debug("dipc: connected to discord at", ipcPath);
              this.ipcClient.removeAllListeners();
              ipcResolve();
            });
            this.ipcClient.connect(ipcPath);
          });

          this.connected = true;
          this.ipcClient.send(
            {
              v: 1,
              client_id: this.clientId
            },
            OPCode.HANDSHAKE
          );

          this.ipcClient.on("close", () => {
            this.connected = false;
            this.emit("close");
          });
          this.ipcClient.on("data", (op: OPCode, json: unknown) => {
            switch (op) {
              case OPCode.PING: {
                this.ipcClient.send(json, OPCode.PONG);
                break;
              }

              // "connect" waits for the READY dispatch rather than firing
              // after the handshake write, so nothing sends an activity into
              // a handshake discord has not accepted yet.
              case OPCode.FRAME: {
                const frame = json as { evt?: string | null; nonce?: string | null; data?: { code?: number; message?: string } | null };
                if (frame?.evt === "READY") {
                  log.debug("dipc: discord handshake ready");
                  this.emit("connect");
                } else if (frame?.evt === "ERROR") {
                  // A rejected SET_ACTIVITY lands here; without this line it
                  // fails without a trace.
                  log.warn("dipc: discord rejected a frame", frame.data?.code, frame.data?.message, frame.nonce);
                }
                break;
              }

              default: {
                break;
              }
            }
          });

          this.connectionPromise = null;
          resolve();

          return;
        } catch {
          index++;
        }
      }

      this.connectionPromise = null;
      reject();
    });

    return this.connectionPromise;
  }

  public close() {
    if (this.connected) {
      this.ipcClient.once("close", () => {
        this.ipcClient.removeAllListeners();
      });
      this.ipcClient.close();
    }
  }

  public destroy() {
    this.connected = false;
    this.removeAllListeners();
    this.ipcClient.destroy();
  }

  public setActivity(activity: DiscordActivity) {
    this.ipcClient.send({
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity
      },
      nonce: randomUUID()
    });
  }

  public clearActivity() {
    this.ipcClient.send({
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid
      },
      nonce: randomUUID()
    });
  }
}
