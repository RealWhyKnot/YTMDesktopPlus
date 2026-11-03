import EventEmitter from "events";
import { IPCClient, OPCode } from "./ipc";
import { type DiscordActivity } from "./types";
import { randomUUID } from "crypto";
import log from "electron-log";
import { existsSync, statSync } from "node:fs";
import { isTestClient } from "../../../test-seams";
import { isRecord } from "~shared/unknown";

function directoryExists(dirPath: string): boolean {
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

const IPC_ID_COUNT = 10;

export function getIPCPaths(): string[] {
  if (isTestClient()) return [];

  const ids = Array.from({ length: IPC_ID_COUNT }, (_unused, id) => id);

  if (process.platform === "win32") {
    return ids.map((id) => `\\\\?\\pipe\\discord-ipc-${id}`);
  }

  const dirtyPrefix =
    [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, process.env.TEMP].find((value) => value !== undefined && value !== "") ?? "/tmp";
  const prefix = dirtyPrefix.replace(/\/$/, "");
  const dirs = [prefix, `${prefix}/snap.discord`, `${prefix}/app/com.discordapp.Discord`].filter(directoryExists);

  return ids.flatMap((id) => dirs.map((dir) => `${dir}/discord-ipc-${id}`));
}

export class DiscordClient extends EventEmitter {
  private clientId: string | null = null;
  private connectionPromise: Promise<void> | null = null;
  private ipcClient = new IPCClient();
  private isConnected = false;

  constructor(clientId: string) {
    super();

    this.clientId = clientId;
  }

  public connect() {
    if (this.connectionPromise) return this.connectionPromise;
    this.ipcClient.removeAllListeners();

    this.connectionPromise = new Promise((resolve, reject) => {
      const connect = async () => {
        const paths = getIPCPaths();
        log.debug(`dipc: initiated connection loop over ${paths.length} candidate paths`);
        let index = 0;
        while (index < paths.length) {
          try {
            await new Promise<void>((ipcResolve, ipcReject) => {
              const ipcPath = paths[index];
              if (ipcPath === undefined) throw new Error("Discord IPC path is unavailable");
              log.debug("dipc: connecting to discord at", ipcPath);
              this.ipcClient.once("close", () => {
                this.ipcClient.removeAllListeners();
                log.debug("dipc: failed to connect to discord at", ipcPath);
                ipcReject(new Error("Discord IPC connection closed"));
              });
              this.ipcClient.once("error", (error) => {
                log.error("dipc: socket error connecting to discord", error);
              });
              this.ipcClient.once("connect", () => {
                log.debug("dipc: connected to discord at", ipcPath);
                this.ipcClient.removeAllListeners();
                ipcResolve();
              });
              this.ipcClient.connect(ipcPath);
            });

            this.isConnected = true;
            this.ipcClient.send(
              {
                v: 1,
                client_id: this.clientId,
              },
              OPCode.HANDSHAKE
            );

            this.ipcClient.on("close", () => {
              this.isConnected = false;
              this.emit("close");
            });
            this.ipcClient.on("data", (op: OPCode, json: unknown) => {
              switch (op) {
                case OPCode.PING: {
                  this.ipcClient.send(json, OPCode.PONG);
                  break;
                }

                case OPCode.FRAME: {
                  if (!isRecord(json)) break;
                  if (json.evt === "READY") {
                    log.debug("dipc: discord handshake ready");
                    this.emit("connect");
                  } else if (json.evt === "ERROR") {
                    const data = isRecord(json.data) ? json.data : undefined;
                    log.warn("dipc: discord rejected a frame", data?.code, data?.message, json.nonce);
                  }
                  break;
                }

                case OPCode.HANDSHAKE:
                case OPCode.CLOSE:
                case OPCode.PONG:
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
        reject(new Error("Could not connect to Discord"));
      };
      void connect().catch(reject);
    });

    return this.connectionPromise;
  }

  public close() {
    if (this.isConnected) {
      this.ipcClient.once("close", () => {
        this.ipcClient.removeAllListeners();
      });
      this.ipcClient.close();
    }
  }

  public destroy() {
    this.isConnected = false;
    this.removeAllListeners();
    this.ipcClient.destroy();
  }

  public setActivity(activity: DiscordActivity) {
    this.ipcClient.send({
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
        activity,
      },
      nonce: randomUUID(),
    });
  }

  public clearActivity() {
    this.ipcClient.send({
      cmd: "SET_ACTIVITY",
      args: {
        pid: process.pid,
      },
      nonce: randomUUID(),
    });
  }
}
