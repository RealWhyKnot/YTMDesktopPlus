import { ipcRenderer } from "electron";
import { objectOf, type GuardMap } from "~shared/validation";

if (process.type !== "renderer") {
  throw new Error("This module can only be used from the renderer process");
}

export class Store<TSchema extends Record<string, unknown>> {
  private readonly guards: GuardMap<TSchema>;

  constructor(guards: GuardMap<TSchema>) {
    this.guards = guards;
  }

  public set(key: string, value?: unknown) {
    ipcRenderer.send("settings:set", key, value);
  }

  public setMany(entries: [string, unknown][]) {
    ipcRenderer.send("settings:setMany", entries);
  }

  public async get<K extends keyof TSchema>(key: K): Promise<TSchema[K]> {
    const value: unknown = await ipcRenderer.invoke("settings:get", key);
    if (!this.guards[key](value)) throw new TypeError(`Invalid settings value: ${String(key)}`);
    return value;
  }

  public reset(key: keyof TSchema) {
    ipcRenderer.send("settings:reset", key);
  }

  public onDidAnyChange(callback: (newState: TSchema, oldState: TSchema) => void) {
    const isState = objectOf(this.guards);
    return ipcRenderer.on("settings:stateChanged", (_event, newState: unknown, oldState: unknown) => {
      if (!isState(newState) || !isState(oldState)) throw new TypeError("Invalid settings state");
      callback(newState, oldState);
    });
  }
}
