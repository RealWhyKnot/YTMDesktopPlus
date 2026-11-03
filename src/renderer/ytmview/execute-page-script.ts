import { ipcRenderer, webFrame, type IpcRendererEvent } from "electron";
import type { Guard } from "~shared/validation";

export async function executePageScript(source: string): Promise<(...args: unknown[]) => unknown> {
  const script: unknown = await webFrame.executeJavaScript(source);
  if (typeof script !== "function") throw new TypeError("Expected a callable page script");
  return (...args): unknown => Reflect.apply(script, undefined, args);
}

export async function readPageValue<T>(source: string, guard: Guard<T>): Promise<T> {
  const value = (await executePageScript(source))();
  if (!guard(value)) throw new TypeError("Invalid page script result");
  return value;
}

export function onAsyncMessage(channel: string, listener: (event: IpcRendererEvent, ...args: unknown[]) => Promise<void>): void {
  ipcRenderer.on(channel, (event, ...args: unknown[]) => {
    void listener(event, ...args).catch((error: unknown) => console.warn(`IPC handler failed: ${channel}`, error));
  });
}
