import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import roomsAddon from "../src/addons/bundled/rooms";
import type { RelayHandlers } from "../src/main/integrations/listen-along/relay-client";
import type { AudioUplinkDeps } from "../src/main/media/audio-uplink";
import { VideoState, type AddonInstance } from "../src/shared/addons/sdk";
import { fakeAddonContext, makePlayerState } from "./helpers/fake-addon-context";

const uplink = vi.hoisted(() => ({
  deps: null as unknown as AudioUplinkDeps,
  instance: { setCredentials: vi.fn(), updateLocalState: vi.fn(), handleCaptureStatus: vi.fn() }
}));
const host = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), connectUplink: vi.fn() }));

vi.mock("../src/main/media/audio-uplink", () => ({
  forkAudioUplink: vi.fn(),
  AudioUplink: vi.fn(function (deps: AudioUplinkDeps) {
    uplink.deps = deps;
    return uplink.instance;
  })
}));
vi.mock("../src/main/media/media-host", () => ({ mediaHost: host }));

type FakeRelay = { handlers: RelayHandlers; url: string; sent: unknown[] };
const relay = vi.hoisted(() => ({ clients: [] as FakeRelay[] }));

vi.mock("../src/main/integrations/listen-along/relay-client", () => ({
  RelayClient: vi.fn(function (handlers: RelayHandlers, url: string) {
    const entry: FakeRelay = { handlers, url, sent: [] };
    relay.clients.push(entry);
    return { connect: vi.fn(), send: (frame: unknown) => entry.sent.push(frame), close: vi.fn(), isOpen: true };
  })
}));

describe("rooms bundled addon", () => {
  it("declares the expected manifest", () => {
    expect(roomsAddon.manifest.id).toBe("rooms");
    expect(roomsAddon.manifest.defaultEnabled).toBe(true);
    expect(roomsAddon.manifest.version).toBe("1.0.0");
  });

  it("registers defaults, settings UI and the room deep link on activate", async () => {
    const { ctx } = fakeAddonContext({ manifest: roomsAddon.manifest });
    await roomsAddon.activate(ctx);

    expect(ctx.settings.registerDefaults).toHaveBeenCalledWith({ displayName: null, audioStreamEnabled: true, autoRoomEnabled: true });

    const registerSettingsUI = ctx.settings.registerSettingsUI as ReturnType<typeof vi.fn>;
    expect(registerSettingsUI).toHaveBeenCalledTimes(1);
    const sections = registerSettingsUI.mock.calls[0][0];
    expect(sections).toHaveLength(1);
    expect(sections[0].fields.map((field: { key: string }) => field.key)).toEqual(["displayName", "audioStreamEnabled", "autoRoomEnabled"]);

    const registerDeepLink = ctx.deepLinks.register as ReturnType<typeof vi.fn>;
    expect(registerDeepLink).toHaveBeenCalledWith("room", expect.any(Function));

    const setMenuItems = ctx.tray.setMenuItems as ReturnType<typeof vi.fn>;
    expect(setMenuItems).toHaveBeenCalledWith([{ label: "Listen Along", click: expect.any(Function) }]);

    // Presence gating, room state and the window channels all ride the
    // public surface only.
    expect(ctx.discord.onEnabledChanged).toHaveBeenCalledTimes(1);
    expect(ctx.memory.get("room")).not.toBeUndefined();
    const ipcOn = ctx.ipc.on as ReturnType<typeof vi.fn>;
    const channels = ipcOn.mock.calls.map(call => call[0]).sort();
    expect(channels).toEqual(["closeWindow", "control", "dismissJoinPrompt", "grant", "host", "join", "leave", "openWindow", "resume"]);

    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("enable", expect.any(String));
    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("disable", expect.any(String));
  });

  it("offers one presence button, pointing at the live room", async () => {
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest });
    await roomsAddon.activate(ctx);

    const provider = captured.buttonsProviders[0];
    expect(provider).toBeDefined();

    expect(provider()).toBeUndefined();

    ctx.memory.set("room", { phase: "hosting", shareUrl: "https://ytmdesktopplus.com/r/abcdefgh" });
    expect(provider()).toEqual([{ label: "Listen Along", url: "https://ytmdesktopplus.com/r/abcdefgh" }]);

    ctx.memory.set("room", { phase: "listening", shareUrl: "https://ytmdesktopplus.com/r/abcdefgh" });
    expect(provider()).toBeUndefined();
  });

  it("listens only for the capture status its page script posts", async () => {
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest });
    await roomsAddon.activate(ctx);

    expect(Object.keys(captured.messageCallbacks)).toEqual(["captureStatus"]);
    expect(() => captured.messageCallbacks["captureStatus"][0](null)).not.toThrow();
  });
});

describe("rooms audio uplink wiring", () => {
  it("lets the uplink switch the capture and feed the room, and feeds it player state and page status", async () => {
    vi.clearAllMocks();
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest });
    await roomsAddon.activate(ctx);
    for (const loaded of captured.loadedCallbacks) loaded();

    uplink.deps.setCapture(true);
    expect(host.start).toHaveBeenCalledTimes(1);
    expect(ctx.ytmview.runScript).toHaveBeenLastCalledWith("enable");

    uplink.deps.onUpdate({ streaming: true, webListeners: 2 });
    expect(ctx.ytmview.runScript).toHaveBeenLastCalledWith("listening-on");
    expect(ctx.memory.get("room")).toMatchObject({ audioStreaming: true, webListenerCount: 2 });

    const send = vi.fn();
    uplink.deps.connectMediaHost(send);
    expect(host.connectUplink).toHaveBeenCalledWith(send);

    host.start.mock.calls[0][0].onStatus({ error: "media host renderer gone" });
    expect(uplink.instance.handleCaptureStatus).toHaveBeenLastCalledWith({ error: "media host renderer gone" });
    captured.messageCallbacks["captureStatus"][0]({ muted: true });
    expect(uplink.instance.handleCaptureStatus).toHaveBeenLastCalledWith({ muted: true });

    const state = makePlayerState({ trackState: VideoState.Playing });
    for (const listener of captured.stateListeners) listener(state);
    expect(uplink.instance.updateLocalState).toHaveBeenLastCalledWith(state);

    uplink.deps.setCapture(false);
    expect(ctx.ytmview.runScript).toHaveBeenLastCalledWith("disable");
    expect(host.stop).toHaveBeenCalledTimes(1);
  });

  it("clears the uplink's credentials when streaming is switched off", async () => {
    vi.clearAllMocks();
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest });
    await roomsAddon.activate(ctx);

    captured.settingsListeners["audioStreamEnabled"](false, true);

    expect(uplink.instance.setCredentials).toHaveBeenLastCalledWith(null);
  });
});

describe("rooms relay reconnects", () => {
  const KEY = "f".repeat(32);

  async function hostAutomatically() {
    vi.clearAllMocks();
    relay.clients.length = 0;
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest, discordEnabled: true });
    const instance = (await roomsAddon.activate(ctx)) as AddonInstance;
    for (const loaded of captured.loadedCallbacks) loaded();
    const lastBadge = () => captured.badges[captured.badges.length - 1];
    const logged = () => vi.mocked(ctx.log.info).mock.calls.map(call => String(call[0]));
    return { ctx, instance, lastBadge, logged };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reclaims the room through its owner, and opens a new one when the relay refuses", async () => {
    const { ctx, lastBadge, logged } = await hostAutomatically();
    expect(relay.clients.map(client => client.url)).toEqual(["wss://ytmdesktopplus.com/relay"]);
    relay.clients[0].handlers.onOpen();
    relay.clients[0].handlers.onFrame({ t: "r", r: "czuupyef", k: KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    expect(lastBadge()?.icon).toBe("headphones");

    relay.clients[0].handlers.onClose();
    expect(lastBadge()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(relay.clients[1].url).toBe("wss://ytmdesktopplus.com/relay?ytmdproom=czuupyef");
    relay.clients[1].handlers.onOpen();
    expect(relay.clients[1].sent).toEqual([{ t: "h", r: "czuupyef", k: KEY }]);

    relay.clients[1].handlers.onFrame({ t: "e", m: "reclaim that room on the node that owns it" });
    expect(relay.clients[2].url).toBe("wss://ytmdesktopplus.com/relay");
    relay.clients[2].handlers.onOpen();
    relay.clients[2].handlers.onFrame({ t: "r", r: "aaaaaaaa", k: KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    expect(lastBadge()?.icon).toBe("headphones");
    expect(ctx.memory.get("room")).toMatchObject({ phase: "hosting", shareUrl: "https://ytmdesktopplus.com/r/aaaaaaaa" });

    expect(logged()).toContain("Room hosting");
    expect(logged().filter(line => line.includes("czuupyef") || line.includes("aaaaaaaa"))).toEqual([]);
  });

  it("regrows the automatic room after the relay refuses it outright", async () => {
    const { lastBadge, logged } = await hostAutomatically();
    relay.clients[0].handlers.onOpen();
    relay.clients[0].handlers.onFrame({ t: "r", r: "czuupyef", k: KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    expect(lastBadge()?.icon).toBe("headphones");
    relay.clients[0].handlers.onClose();
    vi.advanceTimersByTime(1000);
    relay.clients[1].handlers.onOpen();
    relay.clients[1].handlers.onFrame({ t: "e", m: "server busy" });
    expect(lastBadge()).toBeNull();
    expect(logged()).toContain("Room failed: server busy");

    vi.advanceTimersByTime(4999);
    expect(relay.clients).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(relay.clients).toHaveLength(3);
    expect(relay.clients[2].url).toBe("wss://ytmdesktopplus.com/relay");
    relay.clients[2].handlers.onOpen();
    relay.clients[2].handlers.onFrame({ t: "r", r: "aaaaaaaa", k: KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    expect(lastBadge()?.icon).toBe("headphones");
  });

  it("stops touching the relay once the addon is destroyed", async () => {
    const { instance } = await hostAutomatically();
    relay.clients[0].handlers.onOpen();
    relay.clients[0].handlers.onFrame({ t: "e", m: "server busy" });
    instance.destroy();
    vi.advanceTimersByTime(600_000);
    expect(relay.clients).toHaveLength(1);
  });
});
