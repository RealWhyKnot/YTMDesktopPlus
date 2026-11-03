import { requireValue, requireRecord } from "./helpers/require-value";
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { socketServer } from "../src/main/integrations/companion-server/api-shared/socket-server";
import { EventEmitter } from "node:events";
import crypto from "node:crypto";
import type { FastifyInstance, FastifyListenOptions } from "fastify";
import Conf from "conf";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoreSchema } from "../src/shared/store/schema";
import { CompanionServer } from "../src/main/integrations/companion-server";
import { MemoryStore } from "../src/main/memory-store";
import { createAuthToken } from "../src/main/integrations/companion-server/api-shared/auth";
import { makeTempDir } from "./helpers/temp-dir";

const transport = vi.hoisted(() => ({ bindings: [] as { host: string; port: number }[], instances: [] as FastifyInstance[] }));

vi.mock("fastify", async (importOriginal) => {
  const original = await importOriginal<typeof import("fastify")>();
  return {
    ...original,
    default: () => {
      const instance = original.default();
      transport.instances.push(instance);
      const listenTarget: { listen(options: FastifyListenOptions): Promise<string> } = instance;
      vi.spyOn(listenTarget, "listen").mockImplementation((options: unknown) => {
        if (typeof options !== "object" || options === null || !("host" in options) || !("port" in options)) throw new TypeError("Missing bind options");
        if (typeof options.host !== "string" || typeof options.port !== "number") throw new TypeError("Invalid bind options");
        transport.bindings.push({ host: options.host, port: options.port });
        vi.spyOn(instance.server, "listening", "get").mockReturnValue(true);
        return Promise.resolve(instance.ready().then(() => "http://127.0.0.1:9863"));
      });
      return instance;
    },
  };
});

const electron = vi.hoisted(() => {
  Reflect.set(globalThis, "ALL_WINDOWS_VITE_DEV_SERVER_URL", undefined);
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const removeListener = (channel: string, listener: (...args: unknown[]) => void) => {
    listeners.set(
      channel,
      (listeners.get(channel) ?? []).filter((entry) => entry !== listener)
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
    },
  };
  return {
    ipcMain,
    safeStorage: {
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
  };
});

vi.mock("electron", () => ({ ipcMain: electron.ipcMain, safeStorage: electron.safeStorage, BrowserWindow: vi.fn(), WebContentsView: vi.fn() }));

type FakeWindow = EventEmitter & {
  webContents: object;
  options: { webPreferences: { additionalArguments: string[] } };
  closed: boolean;
  show(): void;
  flashFrame(): void;
  close(): void;
};

const windows = vi.hoisted(() => ({ created: [] as FakeWindow[], listeners: new Set<() => void>() }));

vi.mock("../src/main/windows/window-factory", () => ({
  createAppWindow: (options: FakeWindow["options"]) => {
    const window = Object.assign(new EventEmitter(), {
      webContents: {},
      options,
      closed: false,
      show: () => {
        return undefined;
      },
      flashFrame: () => {
        return undefined;
      },
      close: () => {
        window.closed = true;
      },
    });
    windows.created.push(window);
    for (const listener of windows.listeners) listener();
    return window;
  },
  loadWindowEntry: () => {
    return undefined;
  },
}));

const player = vi.hoisted(() => ({ queue: null as null | { items: unknown[]; automixItems: unknown[] } }));

vi.mock("../src/main/player-state-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/main/player-state-store")>();
  return {
    ...original,
    playerStateStore: {
      getState: () => ({ queue: player.queue, videoDetails: null }),
      addEventListener: () => {
        return undefined;
      },
      removeEventListener: () => {
        return undefined;
      },
    },
  };
});

function makeStore(integrations: Partial<StoreSchema["integrations"]> = {}) {
  const store = new Conf<StoreSchema>({ cwd: makeTempDir("ytmd-companion-"), configName: "config", projectVersion: "1.0.0" });
  store.set("integrations", {
    companionServerEnabled: true,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    companionServerLANEnabled: false,
    discordPresenceEnabled: false,
    discordPresenceHideOnPause: false,
    lastFMEnabled: false,
    listenAlongEnabled: false,
    listenAlongHost: null,
    listenAlongHostPort: 9863,
    listenAlongToken: null,
    ...integrations,
  });
  return store;
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
      }),
    },
  };
}
let ytmView = makeYtmView();

let server: InstanceType<typeof CompanionServer> | undefined;
let store: Conf<StoreSchema>;
let memoryStore: InstanceType<typeof MemoryStore>;

async function start(integrations: Partial<StoreSchema["integrations"]> = {}) {
  store = makeStore(integrations);
  memoryStore = new MemoryStore();
  memoryStore.set("safeStorageAvailable", true);
  ytmView = makeYtmView();
  server = new CompanionServer(0);
  server.provide(store, memoryStore, ytmView);
  await server.enable();
  return requireValue(transport.instances.at(-1));
}

function allowUpgrade(headers: Record<string, string>): Promise<boolean> {
  const instance = requireValue(transport.instances.at(-1));
  const allowRequest = socketServer(instance).engine.opts.allowRequest;
  if (allowRequest === undefined) throw new Error("Socket request guard is missing");
  const request = new IncomingMessage(new Socket());
  request.headers = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return new Promise<boolean>((resolve, reject) => {
    allowRequest(request, (error, isAllowed) => {
      if (error) reject(new Error(error));
      else resolve(isAllowed);
    });
  });
}

beforeEach(() => {
  windows.created.length = 0;
  windows.listeners.clear();
  transport.bindings.length = 0;
  transport.instances.length = 0;
  player.queue = null;
});

afterEach(async () => {
  vi.useRealTimers();
  await server?.disable();
  vi.restoreAllMocks();
});

describe("companion server binding and host checks", () => {
  it("listens on loopback only while LAN access is off", async () => {
    await start();
    expect(transport.bindings).toEqual([{ host: "127.0.0.1", port: 0 }]);
  });

  it("listens on every interface once LAN access is on", async () => {
    await start({ companionServerLANEnabled: true });
    expect(transport.bindings).toEqual([{ host: "0.0.0.0", port: 0 }]);
  });

  it.each(["localhost", "localhost:9863", "127.0.0.1:9863", "[::1]:9863", "LOCALHOST"])("accepts Host %s", async (host) => {
    const fastify = await start();
    const response = await fastify.inject({ method: "GET", url: "/metadata", headers: { host } });
    expect(response.statusCode).toBe(200);
  });

  it.each(["evil.example", "evil.example:9863", "127.0.0.1.evil.example", "localhost:9863@evil.example"])("rejects rebound Host %s", async (host) => {
    const fastify = await start();
    const response = await fastify.inject({
      method: "POST",
      url: "/api/v1/auth/requestcode",
      headers: { host },
      payload: { appId: "app", appName: "App", appVersion: "1.0.0" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "INVALID_HOST" });
  });

  it("rejects socket.io upgrades with a foreign Host or Origin", async () => {
    await start();
    const host = "127.0.0.1:9863";
    expect(await allowUpgrade({ Host: host })).toBe(true);
    expect(await allowUpgrade({ Host: host, Origin: `http://${host}` })).toBe(true);
    expect(await allowUpgrade({ Host: "evil.example" })).toBe(false);
    expect(await allowUpgrade({ Host: host, Origin: "http://evil.example" })).toBe(false);
    expect(await allowUpgrade({ Host: host, Origin: "null" })).toBe(false);
  });

  it("lets any Origin upgrade while browser communication is allowed", async () => {
    await start({ companionServerCORSWildcardEnabled: true });
    const host = "127.0.0.1:9863";
    expect(await allowUpgrade({ Host: host, Origin: "http://some.example" })).toBe(true);
    expect(await allowUpgrade({ Host: "evil.example", Origin: "http://some.example" })).toBe(false);
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
      payload: { command: "playQueueIndex", data },
    });
  }

  it("rejects playQueueIndex while there is no queue", async () => {
    const response = await command(0);
    expect(response.statusCode).toBe(400);
    expect(requireRecord(response.json<unknown>()).code).toBe("INVALID_QUEUE_INDEX");
  });

  it.each([1.5, 3])("rejects playQueueIndex %s outside the queue", async (index) => {
    player.queue = { items: [{}, {}], automixItems: [{}] };
    const response = await command(index);
    expect(response.statusCode).toBe(400);
    expect(requireRecord(response.json<unknown>()).code).toBe("INVALID_QUEUE_INDEX");
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
    const index = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === 30 * 1000);
    expect(index).toBeGreaterThan(-1);
    expect(clearTimeoutSpy).toHaveBeenCalledWith(requireValue(setTimeoutSpy.mock.results[index]).value);
  });
});

describe("companion authorization", () => {
  function useAuthClock() {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(Date.UTC(2026, 0, 1));
    let digit = 0;
    vi.spyOn(crypto, "randomInt").mockImplementation(() => digit++ % 10);
  }
  async function requestCode(fastify: import("fastify").FastifyInstance, appId: string, appName = "App") {
    const pending = Promise.resolve(
      fastify.inject({
        method: "POST",
        url: "/api/v1/auth/requestcode",
        headers: { host: "localhost" },
        payload: { appId, appName, appVersion: "1.0.0" },
      })
    );
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(250);
    const response = await pending;
    const body: unknown = response.json();
    if (typeof body !== "object" || body === null || !("code" in body) || typeof body.code !== "string") throw new Error("Missing authorization code");
    return body.code;
  }

  async function waitForWindows(count: number) {
    await vi.advanceTimersByTimeAsync(0);
    if (windows.created.length === count) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const check = () => {
        if (windows.created.length !== count) return;
        windows.listeners.delete(check);
        resolve();
      };
      windows.listeners.add(check);
    });
  }

  function requestIdOf(window: FakeWindow) {
    return window.options.webPreferences.additionalArguments[0];
  }

  it("passes only the request id on the command line and serves the details over IPC", async () => {
    const fastify = await start();
    useAuthClock();
    memoryStore.set("companionServerAuthWindowEnabled", true);
    const appName = "--js-flags=--expose-gc";
    const code = await requestCode(fastify, "app", appName);

    const pending = fastify.inject({ method: "POST", url: "/api/v1/auth/request", headers: { host: "localhost" }, payload: { appId: "app", code } });
    await waitForWindows(1);
    const [window] = windows.created;
    const requestId = requestIdOf(requireValue(window));

    expect(requireValue(window).options.webPreferences.additionalArguments).toEqual([requestId]);
    const details = electron.ipcMain.handlers.get(`companionAuthorization:details:${requestId}`);
    expect(requireValue(details)({ sender: requireValue(window).webContents })).toEqual({ appName, code });
    expect(requireValue(details)({ sender: {} })).toBeNull();

    electron.ipcMain.emit(`companionAuthorization:result:${requestId}`, { sender: requireValue(window).webContents }, false);
    expect((await pending).statusCode).toBe(403);
    expect(electron.ipcMain.handlers.has(`companionAuthorization:details:${requestId}`)).toBe(false);
  });

  it("closes the other pending windows once one app is approved", async () => {
    const fastify = await start();
    useAuthClock();
    memoryStore.set("companionServerAuthWindowEnabled", true);
    const firstCode = await requestCode(fastify, "first");
    const secondCode = await requestCode(fastify, "second");

    const first = fastify.inject({ method: "POST", url: "/api/v1/auth/request", headers: { host: "localhost" }, payload: { appId: "first", code: firstCode } });
    const second = fastify.inject({
      method: "POST",
      url: "/api/v1/auth/request",
      headers: { host: "localhost" },
      payload: { appId: "second", code: secondCode },
    });
    await waitForWindows(2);
    const [firstWindow, secondWindow] = windows.created;

    electron.ipcMain.emit(`companionAuthorization:result:${requestIdOf(requireValue(firstWindow))}`, { sender: requireValue(firstWindow).webContents }, true);

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.statusCode).toBe(200);
    expect(typeof requireRecord(firstResponse.json<unknown>()).token).toBe("string");
    expect(secondResponse.statusCode).toBe(403);
    expect(requireRecord(secondResponse.json<unknown>()).code).toBe("AUTHORIZATION_DENIED");
    expect(requireValue(secondWindow).closed).toBe(true);
    expect(memoryStore.get("companionServerAuthWindowEnabled")).toBe(false);
  });

  it("closes pending windows and refuses approval once pairing is turned off", async () => {
    const fastify = await start();
    useAuthClock();
    memoryStore.set("companionServerAuthWindowEnabled", true);
    const code = await requestCode(fastify, "app");

    const pending = fastify.inject({ method: "POST", url: "/api/v1/auth/request", headers: { host: "localhost" }, payload: { appId: "app", code } });
    await waitForWindows(1);
    const [window] = windows.created;

    memoryStore.set("companionServerAuthWindowEnabled", false);
    electron.ipcMain.emit(`companionAuthorization:result:${requestIdOf(requireValue(window))}`, { sender: requireValue(window).webContents }, true);

    const response = await pending;
    expect(response.statusCode).toBe(403);
    expect(requireValue(window).closed).toBe(true);
  });
});

describe("observed playlist events", () => {
  const mainFrame = { url: "https://music.youtube.com/library", parent: null };

  async function realtimeEmits() {
    const fastify = await start();
    const namespace = socketServer(fastify).of("/api/v1/realtime");
    return vi.spyOn(namespace, "emit");
  }

  it("forwards a created playlist from the YouTube Music main frame", async () => {
    const emit = await realtimeEmits();
    electron.ipcMain.emit("ytmView:createPlaylistObserved", { sender: ytmView.webContents, senderFrame: mainFrame }, { id: "PL1", title: "Mix", extra: 1 });
    expect(emit).toHaveBeenCalledWith("playlist-created", { id: "PL1", title: "Mix" });
  });

  it.each([
    ["a subframe", { url: "https://music.youtube.com/", parent: {} }],
    ["another origin", { url: "https://evil.example/", parent: null }],
    ["no frame", undefined],
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
    { id: "PL1", title: "x".repeat(1025) },
  ])("drops the malformed playlist %j", async (playlist) => {
    const emit = await realtimeEmits();
    electron.ipcMain.emit("ytmView:createPlaylistObserved", { sender: ytmView.webContents, senderFrame: mainFrame }, playlist);
    expect(emit).not.toHaveBeenCalled();
  });

  it.each([undefined, 7, "", "x".repeat(257), { id: "PL1" }])("drops the malformed playlist id %j", async (playlistId) => {
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
