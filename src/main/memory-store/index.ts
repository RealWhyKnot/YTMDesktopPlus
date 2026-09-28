import EventEmitter from "events";
import log from "electron-log";
import { stallTasks } from "../stall-watch";

export default class MemoryStore<T extends Record<string, unknown>> {
  private state: Record<string, unknown>;
  private eventEmitter = new EventEmitter();

  constructor() {
    this.state = {};
    this.eventEmitter.on("error", error => {
      log.error("MemoryStore EventEmitter threw an error", error);
    });
  }

  public get(key: string): unknown {
    return this.state[key as string];
  }

  public getState(): T {
    return this.state as T;
  }

  public set(key: string, value: unknown) {
    stallTasks.timeSync(`MemoryStore.set ${key}`, () => {
      this.state[key as string] = value;
      this.eventEmitter.emit("stateChanged", key, value);
    });
  }

  public onStateChanged(callback: (key: string, value: unknown) => void) {
    this.eventEmitter.addListener("stateChanged", callback);
  }

  public removeOnStateChanged(callback: (key: string, value: unknown) => void) {
    this.eventEmitter.removeListener("stateChanged", callback);
  }
}
