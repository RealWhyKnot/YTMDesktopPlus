import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Conf from "conf";
import type MemoryStore from "../src/main/memory-store";
import type { MemoryStoreSchema, StoreSchema } from "../src/shared/store/schema";

const lan = vi.hoisted(() => ({
  fetches: [] as Array<{ resolve: (value: null) => void; reject: (error: Error) => void }>,
  sockets: [] as Array<{ socket: EventEmitter & { disconnect: () => void; disconnected: boolean }; handlers: { onDisconnect(): void } }>
}));

vi.mock("electron", () => ({
  app: { getVersion: () => "0.0.0-test" },
  safeStorage: { decryptString: () => "token", encryptString: (value: string) => Buffer.from(value) }
}));
vi.mock("electron-log", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../src/main/playback", () => ({ cueTrack: vi.fn(), cancelCue: vi.fn(), sendPlaybackCommand: vi.fn() }));
vi.mock("../src/main/integrations/listen-along/client", async importOriginal => {
  const original = await importOriginal<typeof import("../src/main/integrations/listen-along/client")>();
  return {
    ...original,
    fetchState: vi.fn(
      () =>
        new Promise<null>((resolve, reject) => {
          lan.fetches.push({ resolve, reject });
        })
    ),
    connectRealtime: vi.fn((_host: string, _port: number, _token: string, handlers: { onDisconnect(): void }) => {
      const socket = Object.assign(new EventEmitter(), {
        disconnected: false,
        disconnect() {
          socket.disconnected = true;
        }
      });
      lan.sockets.push({ socket, handlers });
      return socket;
    })
  };
});

import ListenAlong from "../src/main/integrations/listen-along";

function makeListenAlong() {
  const integrations = { listenAlongHost: "192.168.1.20", listenAlongHostPort: 9863, listenAlongToken: "00" };
  const store = { get: () => integrations, set: vi.fn() } as unknown as Conf<StoreSchema>;
  const memory = new Map<string, unknown>([["safeStorageAvailable", true]]);
  const memoryStore = {
    get: (key: string) => memory.get(key),
    set: (key: string, value: unknown) => memory.set(key, value)
  } as unknown as MemoryStore<MemoryStoreSchema>;
  const listenAlong = new ListenAlong();
  listenAlong.provide(store, memoryStore);
  return { listenAlong, memory };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("LAN listen along connections", () => {
  let current: ListenAlong | null = null;

  afterEach(() => {
    current?.disable();
    current = null;
    lan.fetches.length = 0;
    lan.sockets.length = 0;
  });

  it("closes the old socket before opening another", async () => {
    vi.useFakeTimers();
    try {
      const { listenAlong } = makeListenAlong();
      current = listenAlong;
      listenAlong.enable();
      lan.fetches[0].resolve(null);
      await vi.advanceTimersByTimeAsync(0);
      expect(lan.sockets).toHaveLength(1);

      lan.sockets[0].handlers.onDisconnect();
      await vi.advanceTimersByTimeAsync(1000);
      lan.fetches[1].resolve(null);
      await vi.advanceTimersByTimeAsync(0);

      expect(lan.sockets).toHaveLength(2);
      expect(lan.sockets[0].socket.disconnected).toBe(true);
      expect(lan.sockets[1].socket.disconnected).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops a connect that a newer one overtook while it waited for the host", async () => {
    const { listenAlong } = makeListenAlong();
    current = listenAlong;
    listenAlong.enable();
    const connect = (listenAlong as unknown as { connect(): Promise<void> }).connect.bind(listenAlong);
    void connect();
    expect(lan.fetches).toHaveLength(2);

    lan.fetches[1].resolve(null);
    await flush();
    lan.fetches[0].resolve(null);
    await flush();

    expect(lan.sockets).toHaveLength(1);
  });

  it("ignores a disconnect from a socket it already replaced", async () => {
    vi.useFakeTimers();
    try {
      const { listenAlong, memory } = makeListenAlong();
      current = listenAlong;
      listenAlong.enable();
      lan.fetches[0].resolve(null);
      await vi.advanceTimersByTimeAsync(0);
      const connect = (listenAlong as unknown as { connect(): Promise<void> }).connect.bind(listenAlong);
      void connect();
      lan.fetches[1].resolve(null);
      await vi.advanceTimersByTimeAsync(0);
      memory.set("listenAlongStatus", "connected");

      lan.sockets[0].handlers.onDisconnect();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(memory.get("listenAlongStatus")).toBe("connected");
      expect(lan.fetches).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops a connect that was waiting on the host when listen along is turned off", async () => {
    const { listenAlong } = makeListenAlong();
    listenAlong.enable();
    listenAlong.disable();

    lan.fetches[0].resolve(null);
    await flush();

    expect(lan.sockets).toHaveLength(0);
  });
});
