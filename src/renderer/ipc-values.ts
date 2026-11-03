import { ipcRenderer } from "electron";
import type { Guard } from "~shared/validation";

export async function invokeValue<T>(channel: string, guard: Guard<T>, ...args: unknown[]): Promise<T> {
  const value: unknown = await ipcRenderer.invoke(channel, ...args);
  if (!guard(value)) throw new TypeError(`Invalid IPC response: ${channel}`);
  return value;
}

export async function invokeUnknown(channel: string, ...args: unknown[]): Promise<unknown> {
  return await ipcRenderer.invoke(channel, ...args);
}
