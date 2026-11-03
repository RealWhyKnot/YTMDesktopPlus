import EventEmitter from "events";
import log from "electron-log";
import { stallTasks } from "../stall-watch";

export class MemoryStore<T extends Record<string, unknown>> {
  private state: Partial<T>;
  private eventEmitter = new EventEmitter();

  constructor() {
    this.state = {};
    this.eventEmitter.on("error", (error) => {
      log.error("MemoryStore EventEmitter threw an error", error);
    });
  }

  public get(key: string): unknown {
    return Reflect.get(this.state, key);
  }

  public getState(): Partial<T> {
    return this.state;
  }

  public set<K extends keyof T & string>(key: K, value: T[K]) {
    stallTasks.timeSync(`MemoryStore.set ${key}`, () => {
      this.state[key] = value;
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
