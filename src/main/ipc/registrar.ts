import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";

export type IpcRegistrar = {
  on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void;
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
};
