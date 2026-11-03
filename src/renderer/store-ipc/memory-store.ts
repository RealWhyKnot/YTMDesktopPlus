import { ipcRenderer } from "electron";
import { partialObjectOf, type GuardMap } from "~shared/validation";

if (process.type !== "renderer") {
  throw new Error("This module can only be used from the renderer process");
}

type StateCallback<TSchema> = (newState: Partial<TSchema>, oldState: Partial<TSchema>) => void;

export class MemoryStore<TSchema extends Record<string, unknown>> {
  private state: Partial<TSchema> | null = null;
  private readonly guards: GuardMap<TSchema>;
  private callbacks: StateCallback<TSchema>[] = [];

  constructor(guards: GuardMap<TSchema>) {
    this.guards = guards;
    const isState = partialObjectOf(guards);
    ipcRenderer.on("memoryStore:state", (_event, state: unknown) => {
      if (!isState(state)) throw new TypeError("Invalid memory state");
      this.state = state;
    });
    ipcRenderer.on("memoryStore:stateChanged", (_event, key: string, value: unknown) => {
      if (this.state === null) return;
      const oldState = this.state;
      const state = { ...oldState, [key]: value };
      if (!isState(state)) throw new TypeError(`Invalid memory value: ${key}`);
      this.state = state;
      for (const callback of this.callbacks.slice()) {
        callback(this.state, oldState);
      }
    });
    ipcRenderer.send("memoryStore:subscribe");
  }

  public set(key: string, value?: unknown) {
    ipcRenderer.send("memoryStore:set", key, value);
  }

  public async get<K extends keyof TSchema>(key: K): Promise<TSchema[K] | undefined> {
    const value: unknown = await ipcRenderer.invoke("memoryStore:get", key);
    if (value === undefined) return value;
    if (!this.guards[key](value)) throw new TypeError(`Invalid memory value: ${String(key)}`);
    return value;
  }

  public onStateChanged(callback: StateCallback<TSchema>) {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index !== -1) this.callbacks.splice(index, 1);
    };
  }
}
