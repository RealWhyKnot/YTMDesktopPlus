import { ipcRenderer } from "electron";

if (process.type !== "renderer") {
  throw new Error("This module can only be used from the renderer process");
}

type StateCallback<TSchema> = (newState: TSchema, oldState: TSchema) => void;

export default class MemoryStore<TSchema> {
  private state: TSchema | null = null;
  private callbacks: StateCallback<TSchema>[] = [];

  constructor() {
    ipcRenderer.on("memoryStore:state", (event, state: TSchema) => {
      this.state = state;
    });
    ipcRenderer.on("memoryStore:stateChanged", (event, key: string, value: unknown) => {
      if (this.state === null) return;
      const oldState = this.state;
      this.state = { ...oldState, [key]: value };
      for (const callback of this.callbacks.slice()) {
        callback(this.state, oldState);
      }
    });
    ipcRenderer.send("memoryStore:subscribe");
  }

  public set(key: string, value?: unknown) {
    return ipcRenderer.send("memoryStore:set", key, value);
  }

  public async get(key: keyof TSchema) {
    return await ipcRenderer.invoke("memoryStore:get", key);
  }

  public onStateChanged(callback: StateCallback<TSchema>) {
    this.callbacks.push(callback);
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index !== -1) this.callbacks.splice(index, 1);
    };
  }
}
