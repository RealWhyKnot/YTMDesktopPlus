import http from "node:http";
import { EventEmitter } from "node:events";
import Conf from "conf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreSchema } from "../src/shared/store/schema";
import CompanionServer from "../src/main/integrations/companion-server";
import MemoryStore from "../src/main/memory-store";
import { createAuthToken } from "../src/main/integrations/companion-server/api-shared/auth";
import { makeTempDir } from "./helpers/temp-dir";

const electron = vi.hoisted(() => {
  (globalThis as Record<string, unknown>).ALL_WINDOWS_VITE_DEV_SERVER_URL = undefined;
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const removeListener = (channel: string, listener: (...args: unknown[]) => void) => {
    listeners.set(
      channel,
      (listeners.get(channel) ?? []).filter(entry => entry !== listener)
    );
  };
  const ipcMain = {
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      listeners.set(channel, [...(listeners.get(channel) ?? []), listener]);
    },
    once: (channel: string, listener: (...args: unknown[]) => void) => {
      const wrapper = (...args: unknown[]) => {
        removeListener(channel, wrapper);
        listener(...args);
      };
      ipcMain.on(channel, wrapper);
    },
    off: removeListener,
    removeListener,
    emit: (channel: string, ...args: unknown[]) => {
      for (const listener of listeners.get(channel) ?? []) listener(...args);
    },
    handlers,
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      if (handlers.has(channel)) throw new Error(`handler already registered for ${channel}`);
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    }
  };
  return {
    ipcMain,
    safeStorage: {
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString()
    }
  };
});

vi.mock("electron", () => ({ ipcMain: electron.ipcMain, safeStorage: electron.safeStorage, BrowserWindow: class {}, BrowserView: class {} }));

type FakeWindow = EventEmitter & {
  webContents: object;
  options: { webPreferences: { additionalArguments: string[] } };
  closed: boolean;
  show(): void;
  flashFrame(): void;
  close(): void;
};

const windows = vi.hoisted(() => ({ created: [] as FakeWindow[] }));

vi.mock("../src/main/windows/window-factory", () => ({
  createAppWindow: (options: FakeWindow["options"]) => {
    const window = Object.assign(new EventEmitter(), {
      webContents: {},
      options,
      closed: false,
      show: () => {},
      flashFrame: () => {},
      close: () => {
        window.closed = true;
      }
    }) as FakeWindow;
    windows.created.push(window);
    return window;
  },
  loadWindowEntry: () => {}
}));

const player = vi.hoisted(() => ({ queue: null as null | { items: unknown[]; automixItems: unknown[] } }));

vi.mock("../src/main/player-state-store", async importOriginal => {
  const original = await importOriginal<typeof import("../src/main/player-state-store")>();
  return {
    ...original,
    default: {
      getState: () => ({ queue: player.queue, videoDetails: null as null }),
      addEventListener: () => {},
      removeEventListener: () => {}
    }
  };
});

type ServerInternals = { fastifyServer: import("fastify").FastifyInstance };

function makeStore(integrations: Partial<StoreSchema["integrations"]> = {}) {
  return new Conf({
    cwd: makeTempDir("ytmd-companion-"),
    configName: "config",
    defaults: {
      integrations: {
        companionServerEnabled: true,
        companionServerAuthTokens: null,
        companionServerCORSWildcardEnabled: false,
        companionServerLANEnabled: false,
        ...integrations
      }
    },
    projectVersion: "1.0.0"
  }) as unknown as Conf<StoreSchema>;
}

function makeYtmView() {
  return {
    webContents: {
      send: vi.fn((channel: string, requestId: string) => {
        if (channel === "ytmView:getPlaylists") {
          queueMicrotask(() => {
            electron.ipcMain.emit(`ytmView:getPlaylists:response:${requestId}`, { sender: ytmView.webContents }, [{ id: "PL1", title: "One" }]);
          });
        }
      })
    }
  };
}
let ytmView = makeYtmView();

let server: InstanceType<typeof CompanionServer>;
let store: Conf<StoreSchema>;
let memoryStore: InstanceType<typeof MemoryStore>;

async function start(integrations: Partial<StoreSchema["integrations"]> = {}) {
  store = makeStore(integrations);
  memoryStore = new MemoryStore();
  memoryStore.set("safeStorageAvailable", true);
  ytmView = makeYtmView();
  server = new CompanionServer(0);
  server.provide(store, memoryStore as never, ytmView as never);
  await server.enable();
  return (server as unknown as ServerInternals).fastifyServer;
}

function port() {
  return ((server as unknown as ServerInternals).fastifyServer.server.address() as { port: number }).port;
}

function upgrade(headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: port(),
      path: "/socket.io/?EIO=4&transport=websocket",
      headers: {
        "Connection": "Upgrade",
        "Upgrade": "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...headers
      }
    });
    request.on("upgrade", (response, socket) => {
      socket.destroy();
      resolve(response.statusCode);
    });
    request.on("response", response => {
      response.resume();
      resolve(response.statusCode);
    });
    request.on("error", reject);
    request.end();
  });
}

beforeEach(() => {
  windows.created.length = 0;
  player.queue = null;
});

afterEach(async () => {
  await server?.disable();
  vi.restoreAllMocks();
});

describe("companion server binding and host checks", () => {
  it("listens on loopback only while LAN access is off", async () => {
    const fastify = await start();
    expect((fastify.server.address() as { address: string }).address).toBe("127.0.0.1");
  });

  it("listens on every interface once LAN access is on", async () => {
    const fastify = await start({ companionServerLANEnabled: true });
    expect((fastify.server.address() as { address: string }).address).toBe("0.0.0.0");
  });

  it.each(["localhost", "localhost:9863", "127.0.0.1:9863", "[::1]:9863", "LOCALHOST"])("accepts Host %s", async host => {
    const fastify = await start();
    const response = await fastify.inject({ method: "GET", url: "/metadata", headers: { host } });
    expect(response.statusCode).toBe(200);
  });

  it.each(["evil.example", "evil.example:9863", "127.0.0.1.evil.example", "localhost:9863@evil.example"])("rejects rebound Host %s", async host => {
    const fastify = await start();
    const response = await fastify.inject({
      method: "POST",
      url: "/api/v1/auth/requestcode",
      headers: { host },
      payload: { appId: "app", appName: "App", appVersion: "1.0.0" }
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "INVALID_HOST" });
  });

  it("rejects socket.io upgrades with a foreign Host or Origin", async () => {
    await start();
    const host = `127.0.0.1:${port()}`;
    expect(await upgrade({ Host: host })).toBe(101);
    expect(await upgrade({ Host: host, Origin: `http://${host}` })).toBe(101);
    expect(await upgrade({ Host: "evil.example" })).not.toBe(101);
    expect(await upgrade({ Host: host, Origin: "http://evil.example" })).not.toBe(101);
    expect(await upgrade({ Host: host, Origin: "null" })).not.toBe(101);
  });

  it("lets any Origin upgrade while browser communication is allowed", async () => {
    await start({ companionServerCORSWildcardEnabled: true });
    const host = `127.0.0.1:${port()}`;
    expect(await upgrade({ Host: host, Origin: "http://some.example" })).toBe(101);
    expect(await upgrade({ Host: "evil.example", Origin: "http://some.example" })).not.toBe(101);
  });
});

describe("companion server rate limits", () => {
  it("counts unauthenticated requests against the route limit", async () => {
    const fastify = await start();
    const first = await fastify.inject({ method: "GET", url: "/api/v1/state", headers: { host: "localhost" } });
    const second = await fastify.inject({ method: "GET", url: "/api/v1/state", headers: { host: "localhost" } });
    expect(first.statusCode).toBe(401);
    expect(second.statusCode).toBe(429);
  });

  it("keeps a separate budget for each valid token", async () => {
    const fastify = await start();
    const token = createAuthToken(store, "app", "1.0.0", "App");
    await fastify.inject({ method: "GET", url: "/api/v1/state", headers: { host: "localhost" } });
    const authed = await fastify.inject({ method: "GET", url: "/api/v1/state", headers: { host: "localhost", authorization: token } });
    expect(authed.statusCode).toBe(200);
  });
});

describe("companion commands", () => {
  async function command(data: unknown) {
    const fastify = await start();
    const token = createAuthToken(store, "app", "1.0.0", "App");
    return fastify.inject({
      method: "POST",
      url: "/api/v1/command",
      headers: { host: "localhost", authorization: token },
      payload: { command: "playQueueIndex", data }
    });
  }

  it("rejects playQueueIndex while there is no queue", async () => {
    const response = await command(0);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_QUEUE_INDEX");
  });

  it.each([1.5, 3])("rejects playQueueIndex %s outside the queue", async index => {
    player.queue = { items: [{}, {}], automixItems: [{}] };
    const response = await command(index);
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("INVALID_QUEUE_INDEX");
  });

  it("plays an index inside the queue", async () => {
    player.queue = { items: [{}, {}], automixItems: [{}] };
    const response = await command(2);
    expect(response.statusCode).toBe(204);
    expect(ytmView.webContents.send).toHaveBeenCalledWith("remoteControl:execute", "playQueueIndex", 2);
  });

  it("clears the playlists timeout once YouTube Music answers", async () => {
    const fastify = await start();
    const token = createAuthToken(store, "app", "1.0.0", "App");
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const response = await fastify.inject({ method: "GET", url: "/api/v1/playlists", headers: { host: "localhost", authorization: token } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ id: "PL1", title: "One" }]);
    const index = setTimeoutSpy.mock.calls.findIndex(call => call[1] === 30 * 1000);
    expect(index).toBeGreaterThan(-1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(setTimeoutSpy.mock.results[index].value);
  });
});

describe("companion authorization", () => {
  async function requestCode(fastify: import("fastify").FastifyInstance, appId: string, appName = "App") {
    const response = await fastify.inject({
      method: "POST",
      url: "/api/v1/auth/requestcode",
      headers: { host: "localhost" },
      payload: { appId, appName, appVersion: "1.0.0" }
    });
    return response.json().code as string;
  }

  async function waitForWindows(count: number) {
    await vi.waitFor(() => expect(windows.created.length).toBe(count));
  }

  function requestIdOf(window: FakeWindow) {
    return window.options.webPreferences.additionalArguments[0];
  }

  it("passes only the request id on the command line and serves the details over IPC", async () => {
    const fastify = await start();
    memoryStore.set("companionServerAuthWindowEnabled", true);
    const appName = "--js-flags=--expose-gc";
    const code = await requestCode(fastify, "app", appName);

    const pending = fastify.inject({ method: "POST", url: "/api/v1/auth/request", headers: { host: "localhost" }, payload: { appId: "app", code } });
    await waitForWindows(1);
    const [window] = windows.created;
    const requestId = requestIdOf(window);

    expect(window.options.webPreferences.additionalArguments).toEqual([requestId]);
    const details = electron.ipcMain.handlers.get(`companionAuthorization:details:${requestId}`);
    expect(details({ sender: window.webContents })).toEqual({ appName, code });
    expect(details({ sender: {} })).toBeNull();

    electron.ipcMain.emit(`companionAuthorization:result:${requestId}`, { sender: window.webContents }, false);
    expect((await pending).statusCode).toBe(403);
    expect(electron.ipcMain.handlers.has(`companionAuthorization:details:${requestId}`)).toBe(false);
  });

  it("closes the other pending windows once one app is approved", async () => {
    const fastify = await start();
    memoryStore.set("companionServerAuthWindowEnabled", true);
    const firstCode = await requestCode(fastify, "first");
    const secondCode = await requestCode(fastify, "second");

    const first = fastify.inject({ method: "POST", url: "/api/v1/auth/request", headers: { host: "localhost" }, payload: { appId: "first", code: firstCode } });
    const second = fastify.inject({
      method: "POST",
      url: "/api/v1/auth/request",
      headers: { host: "localhost" },
      payload: { appId: "second", code: secondCode }
    });
    await waitForWindows(2);
    const [firstWindow, secondWindow] = windows.created;

    electron.ipcMain.emit(`companionAuthorization:result:${requestIdOf(firstWindow)}`, { sender: firstWindow.webContents }, true);

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.statusCode).toBe(200);
    expect(typeof firstResponse.json().token).toBe("string");
    expect(secondResponse.statusCode).toBe(403);
    expect(secondResponse.json().code).toBe("AUTHORIZATION_DENIED");
    expect(secondWindow.closed).toBe(true);
    expect(memoryStore.get("companionServerAuthWindowEnabled")).toBe(false);
  });

  it("closes pending windows and refuses approval once pairing is turned off", async () => {
    const fastify = await start();
    memoryStore.set("companionServerAuthWindowEnabled", true);
    const code = await requestCode(fastify, "app");

    const pending = fastify.inject({ method: "POST", url: "/api/v1/auth/request", headers: { host: "localhost" }, payload: { appId: "app", code } });
    await waitForWindows(1);
    const [window] = windows.created;

    memoryStore.set("companionServerAuthWindowEnabled", false);
    electron.ipcMain.emit(`companionAuthorization:result:${requestIdOf(window)}`, { sender: window.webContents }, true);

    const response = await pending;
    expect(response.statusCode).toBe(403);
    expect(window.closed).toBe(true);
  });
});

describe("observed playlist events", () => {
  const mainFrame = { url: "https://music.youtube.com/library", parent: null as null };

  async function realtimeEmits() {
    const fastify = await start();
    const namespace = (fastify as unknown as { io: import("socket.io").Server }).io.of("/api/v1/realtime");
    return vi.spyOn(namespace, "emit");
  }

  it("forwards a created playlist from the YouTube Music main frame", async () => {
    const emit = await realtimeEmits();
    electron.ipcMain.emit("ytmView:createPlaylistObserved", { sender: ytmView.webContents, senderFrame: mainFrame }, { id: "PL1", title: "Mix", extra: 1 });
    expect(emit).toHaveBeenCalledWith("playlist-created", { id: "PL1", title: "Mix" });
  });

  it.each([
    ["a subframe", { url: "https://music.youtube.com/", parent: {} }],
    ["another origin", { url: "https://evil.example/", parent: null as null }],
    ["no frame", undefined]
  ])("ignores events from %s", async (_label, senderFrame) => {
    const emit = await realtimeEmits();
    electron.ipcMain.emit("ytmView:createPlaylistObserved", { sender: ytmView.webContents, senderFrame }, { id: "PL1", title: "Mix" });
    electron.ipcMain.emit("ytmView:deletePlaylistObserved", { sender: ytmView.webContents, senderFrame }, "PL1");
    expect(emit).not.toHaveBeenCalled();
  });

  it("ignores events from other web contents", async () => {
    const emit = await realtimeEmits();
    electron.ipcMain.emit("ytmView:deletePlaylistObserved", { sender: {}, senderFrame: mainFrame }, "PL1");
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([
    null,
    "PL1",
    { id: 1, title: "Mix" },
    { id: "", title: "Mix" },
    { id: "PL1" },
    { id: "x".repeat(257), title: "Mix" },
    { id: "PL1", title: "x".repeat(1025) }
  ])("drops the malformed playlist %j", async playlist => {
    const emit = await realtimeEmits();
    electron.ipcMain.emit("ytmView:createPlaylistObserved", { sender: ytmView.webContents, senderFrame: mainFrame }, playlist);
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([undefined, 7, "", "x".repeat(257), { id: "PL1" }])("drops the malformed playlist id %j", async playlistId => {
    const emit = await realtimeEmits();
    electron.ipcMain.emit("ytmView:deletePlaylistObserved", { sender: ytmView.webContents, senderFrame: mainFrame }, playlistId);
    expect(emit).not.toHaveBeenCalled();
  });

  it("forwards a deleted playlist id", async () => {
    const emit = await realtimeEmits();
    electron.ipcMain.emit("ytmView:deletePlaylistObserved", { sender: ytmView.webContents, senderFrame: mainFrame }, "PL1");
    expect(emit).toHaveBeenCalledWith("playlist-deleted", "PL1");
  });
});
