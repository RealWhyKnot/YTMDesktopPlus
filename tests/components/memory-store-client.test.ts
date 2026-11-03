import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireRecord } from "../helpers/require-value";
import type { ThemeDescriptor } from "../../src/shared/themes/sdk";

type Listener = (event: unknown, ...args: unknown[]) => void;

const ipc = vi.hoisted(() => {
  const processType = (process as { type?: string }).type;
  (process as { type?: string }).type = "renderer";
  process.argv.push("--ytmd-addon-id=demo", "--ytmd-addon-theme=0");
  const listeners = new Map<string, Listener[]>();
  const sent: unknown[][] = [];
  const exposed = new Map<string, unknown>();
  return {
    processType,
    sent,
    exposed,
    emit: (channel: string, ...args: unknown[]) => {
      for (const listener of listeners.get(channel) ?? []) listener({}, ...args);
    },
    electron: {
      ipcRenderer: {
        on: (channel: string, listener: Listener) => {
          listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
        },
        send: (...args: unknown[]) => {
          sent.push(args);
        },
      },
      contextBridge: {
        exposeInMainWorld: (name: string, api: unknown) => exposed.set(name, api),
      },
    },
  };
});

vi.mock("electron", () => ipc.electron);

import { MemoryStore } from "../../src/renderer/store-ipc/memory-store";
import "../../src/renderer/windows/addon/preload";

(process as { type?: string }).type = ipc.processType;
process.argv.splice(-2);

type State = Record<string, unknown>;
const themes: ThemeDescriptor[] = [
  {
    manifest: { id: "a", name: "A", version: "1.0.0", author: "Test", description: "Test theme" },
    origin: "user",
    active: false,
    state: "ok",
    warnings: [],
    swatch: [],
    watching: false,
  },
];

function record(store: MemoryStore<State>) {
  const calls: [State, State][] = [];
  store.onStateChanged((newState, oldState) => calls.push([newState, oldState]));
  return calls;
}

beforeEach(() => {
  ipc.sent.length = 0;
});

describe("renderer MemoryStore", () => {
  it("asks main for the full state when it is created", () => {
    new MemoryStore<State>({});

    expect(ipc.sent).toEqual([["memoryStore:subscribe"]]);
  });

  it("rebuilds the full new and old state from each changed key", () => {
    const calls = record(new MemoryStore<State>({}));
    ipc.emit("memoryStore:state", { ytmViewLoading: true, themesRuntime: themes });

    ipc.emit("memoryStore:stateChanged", "ytmViewLoading", false);
    ipc.emit("memoryStore:stateChanged", "ytmViewLoadingStatus", "Loaded");

    expect(calls).toEqual([
      [
        { ytmViewLoading: false, themesRuntime: themes },
        { ytmViewLoading: true, themesRuntime: themes },
      ],
      [
        { ytmViewLoading: false, themesRuntime: themes, ytmViewLoadingStatus: "Loaded" },
        { ytmViewLoading: false, themesRuntime: themes },
      ],
    ]);
  });

  it("gives a late window every key main already holds", () => {
    const calls = record(new MemoryStore<State>({}));
    ipc.emit("memoryStore:stateChanged", "ytmViewLoading", true);
    ipc.emit("memoryStore:state", { safeStorageAvailable: true, ytmViewLoading: true });
    ipc.emit("memoryStore:stateChanged", "appUpdateAvailable", true);

    expect(calls).toEqual([
      [
        { safeStorageAvailable: true, ytmViewLoading: true, appUpdateAvailable: true },
        { safeStorageAvailable: true, ytmViewLoading: true },
      ],
    ]);
  });

  it("calls listeners in the order they subscribed until they unsubscribe", () => {
    const store = new MemoryStore<State>({});
    const order: string[] = [];
    const unsubscribeFirst = store.onStateChanged(() => order.push("first"));
    store.onStateChanged(() => order.push("second"));
    ipc.emit("memoryStore:state", {});

    ipc.emit("memoryStore:stateChanged", "a", 1);
    unsubscribeFirst();
    ipc.emit("memoryStore:stateChanged", "a", 2);

    expect(order).toEqual(["first", "second", "second"]);
  });

  it("gives an addon window its own memory on every change", () => {
    const memory = requireRecord(requireRecord(ipc.exposed.get("ytmdAddon")).memory);
    const onChanged = memory.onChanged;
    if (typeof onChanged !== "function") throw new TypeError("Expected a memory subscription");
    const seen: unknown[] = [];

    const unsubscribe: unknown = Reflect.apply(onChanged, memory, [(value: unknown) => seen.push(value)]);
    if (typeof unsubscribe !== "function") throw new TypeError("Expected an unsubscribe function");
    ipc.emit("memoryStore:state", { addonMemory: { demo: { step: 1 } }, ytmViewLoading: true });
    ipc.emit("memoryStore:stateChanged", "ytmViewLoading", false);
    ipc.emit("memoryStore:stateChanged", "addonMemory", { demo: { step: 2 }, other: {} });
    Reflect.apply(unsubscribe, undefined, []);
    ipc.emit("memoryStore:stateChanged", "addonMemory", { demo: { step: 3 } });

    expect(seen).toEqual([{ step: 1 }, { step: 2 }]);
  });
});
