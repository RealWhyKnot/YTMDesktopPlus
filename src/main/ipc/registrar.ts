import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";

// Structural subset of ipcMain so handler modules can be exercised with a
// capturing fake (tests/ipc-channels.test.ts).
export interface IpcRegistrar {
  on(channel: string, listener: (event: IpcMainEvent, ...args: unknown[]) => void): void;
  handle(channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown): void;
}
