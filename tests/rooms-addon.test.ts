import { requireValue } from "./helpers/require-value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { roomsAddon } from "../src/addons/bundled/rooms";
import type { RelayHandlers } from "../src/main/integrations/listen-along/relay-client";
import type { AudioUplinkDeps } from "../src/main/media/audio-uplink";
import type { MediaHostConsumer } from "../src/main/media/media-host";
import { VideoState } from "../src/shared/addons/sdk";
import { fakeAddonContext, makePlayerState } from "./helpers/fake-addon-context";

const uplink = vi.hoisted(() => {
  const dependencies: { current?: AudioUplinkDeps } = {};
  return {
    dependencies,
    instance: {
      setCredentials: vi.fn(),
      updateLocalState: vi.fn(),
      handleCaptureStatus: vi.fn(),
      setClockOffset: vi.fn(),
      rearm: vi.fn(),
      reconnectNow: vi.fn(),
    },
  };
});
const host = vi.hoisted(() => ({ start: vi.fn<(consumer: MediaHostConsumer) => void>(), stop: vi.fn(), connectUplink: vi.fn() }));
const resume = vi.hoisted(() => ({ listeners: [] as (() => void)[] }));
const playback = vi.hoisted(() => ({ cancelCue: vi.fn() }));

vi.mock("../src/main/integrations/listen-along/system-resume", () => ({
  onSystemResume: vi.fn((listener: () => void) => {
    resume.listeners.push(listener);
    return () => {
      resume.listeners = resume.listeners.filter((entry) => entry !== listener);
    };
  }),
}));
vi.mock("../src/main/playback", () => playback);

vi.mock("../src/main/media/audio-uplink", () => ({
  forkAudioUplink: vi.fn(),
  AudioUplink: vi.fn(function (deps: AudioUplinkDeps) {
    uplink.dependencies.current = deps;
    return uplink.instance;
  }),
}));
vi.mock("../src/main/media/media-host", () => ({ mediaHost: host }));

type FakeRelay = { handlers: RelayHandlers; url: string; sent: unknown[] };
const relay = vi.hoisted(() => ({ clients: [] as FakeRelay[] }));

vi.mock("../src/main/integrations/listen-along/relay-client", () => ({
  RelayClient: vi.fn(function (handlers: RelayHandlers, url: string) {
    const entry: FakeRelay = { handlers, url, sent: [] };
    relay.clients.push(entry);
    return { connect: vi.fn(), send: (frame: unknown) => entry.sent.push(frame), close: vi.fn(), isOpen: true };
  }),
}));

describe("rooms bundled addon", () => {
  it("declares the expected manifest", () => {
    expect(roomsAddon.manifest.id).toBe("rooms");
    expect(roomsAddon.manifest.defaultEnabled).toBe(true);
    expect(roomsAddon.manifest.version).toBe("1.0.0");
  });

  it("registers defaults, settings UI and the room deep link on activate", () => {
    const { ctx } = fakeAddonContext({ manifest: roomsAddon.manifest });
    roomsAddon.activate(ctx);

    expect(ctx.settings.registerDefaults).toHaveBeenCalledWith({ displayName: null, audioStreamEnabled: true, autoRoomEnabled: true });

    const registerSettingsUI = ctx.settings.registerSettingsUI;
    expect(registerSettingsUI).toHaveBeenCalledTimes(1);
    const sections = requireValue(registerSettingsUI.mock.calls[0])[0];
    expect(sections).toHaveLength(1);
    expect(requireValue(sections[0]).fields.map((field) => field.key)).toEqual(["displayName", "audioStreamEnabled", "autoRoomEnabled"]);

    const registerDeepLink = ctx.deepLinks.register;
    expect(registerDeepLink).toHaveBeenCalledWith("room", expect.any(Function));

    const setMenuItems = ctx.tray.setMenuItems;
    const click: unknown = expect.any(Function);
    expect(setMenuItems).toHaveBeenCalledWith([{ label: "Listen Along", click }]);

    expect(ctx.discord.onEnabledChanged).toHaveBeenCalledTimes(1);
    expect(ctx.memory.get("room")).not.toBeUndefined();
    const ipcOn = ctx.ipc.on;
    const channels = ipcOn.mock.calls.map((call) => call[0]).sort();
    expect(channels).toEqual(["closeWindow", "control", "dismissJoinPrompt", "grant", "host", "join", "leave", "openWindow", "resume"]);

    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("enable", expect.any(String));
    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("disable", expect.any(String));
  });

  it("offers one presence button, pointing at the live room", () => {
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest });
    roomsAddon.activate(ctx);

    const provider = captured.buttonsProviders[0];
    expect(provider).toBeDefined();

    expect(requireValue(provider)()).toBeUndefined();

    ctx.memory.set("room", { phase: "hosting", shareUrl: "https://ytmdesktopplus.com/r/abcdefgh" });
    expect(requireValue(provider)()).toEqual([{ label: "Listen Along", url: "https://ytmdesktopplus.com/r/abcdefgh" }]);

    ctx.memory.set("room", { phase: "listening", shareUrl: "https://ytmdesktopplus.com/r/abcdefgh" });
    expect(requireValue(provider)()).toBeUndefined();
  });

  it("listens only for the capture status its page script posts", () => {
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest });
    roomsAddon.activate(ctx);

    expect(Object.keys(captured.messageCallbacks)).toEqual(["captureStatus"]);
    expect(() =>
      requireValue(requireValue(captured.messageCallbacks.captureStatus)[0]).call(requireValue(captured.messageCallbacks.captureStatus), null)
    ).not.toThrow();
  });
});

describe("rooms audio uplink wiring", () => {
  it("lets the uplink switch the capture and feed the room, and feeds it player state and page status", () => {
    vi.clearAllMocks();
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest });
    roomsAddon.activate(ctx);
    for (const loaded of captured.loadedCallbacks) loaded();

    requireValue(uplink.dependencies.current).setCapture(true);
    expect(host.start).toHaveBeenCalledTimes(1);
    expect(ctx.ytmview.runScript).toHaveBeenLastCalledWith("enable");

    requireValue(uplink.dependencies.current).onUpdate({ streaming: true, webListeners: 2, issue: null });
    expect(ctx.ytmview.runScript).toHaveBeenLastCalledWith("listening-on");
    expect(ctx.memory.get("room")).toMatchObject({ audioStreaming: true, webListenerCount: 2, audioIssue: null });

    requireValue(uplink.dependencies.current).onUpdate({ streaming: false, webListeners: 0, issue: "retrying" });
    expect(ctx.memory.get("room")).toMatchObject({ audioStreaming: false, audioIssue: "retrying" });

    const send = vi.fn();
    requireValue(uplink.dependencies.current).connectMediaHost(send);
    expect(host.connectUplink).toHaveBeenCalledWith(send);

    requireValue(host.start.mock.calls[0])[0].onStatus({ error: "media host renderer gone" });
    expect(uplink.instance.handleCaptureStatus).toHaveBeenLastCalledWith({ error: "media host renderer gone" });
    requireValue(requireValue(captured.messageCallbacks.captureStatus)[0]).call(requireValue(captured.messageCallbacks.captureStatus), { muted: true });
    expect(uplink.instance.handleCaptureStatus).toHaveBeenLastCalledWith({ muted: true });

    const state = makePlayerState({ trackState: VideoState.Playing });
    for (const listener of captured.stateListeners) listener(state);
    expect(uplink.instance.updateLocalState).toHaveBeenLastCalledWith(state);

    requireValue(uplink.dependencies.current).setCapture(false);
    expect(ctx.ytmview.runScript).toHaveBeenLastCalledWith("disable");
    expect(host.stop).toHaveBeenCalledTimes(1);
  });

  it("clears the uplink's credentials when streaming is switched off", () => {
    vi.clearAllMocks();
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest });
    roomsAddon.activate(ctx);

    requireValue(captured.settingsListeners.audioStreamEnabled).call(captured.settingsListeners, false, true);

    expect(uplink.instance.setCredentials).toHaveBeenLastCalledWith(null);
  });
});

describe("rooms relay reconnects", () => {
  const KEY = "f".repeat(32);

  function hostAutomatically() {
    vi.clearAllMocks();
    relay.clients.length = 0;
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest, discordEnabled: true });
    const instance = roomsAddon.activate(ctx);
    for (const loaded of captured.loadedCallbacks) loaded();
    const lastBadge = () => captured.badges[captured.badges.length - 1];
    const logged = () => vi.mocked(ctx.log.info).mock.calls.map((call) => String(call[0]));
    return Promise.resolve({ ctx, instance, lastBadge, logged });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 0, 1));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reclaims the room through its owner, and adopts a new one when the relay hands one back", async () => {
    const { ctx, lastBadge, logged } = await hostAutomatically();
    expect(relay.clients.map((client) => client.url)).toEqual(["wss://ytmdesktopplus.com/relay"]);
    requireValue(relay.clients[0]).handlers.onOpen();
    requireValue(relay.clients[0]).handlers.onFrame({ t: "r", r: "czuupyef", k: KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    expect(lastBadge()?.icon).toBe("headphones");

    requireValue(relay.clients[0]).handlers.onClose();
    expect(lastBadge()).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(requireValue(relay.clients[1]).url).toBe("wss://ytmdesktopplus.com/relay?ytmdproom=czuupyef");
    requireValue(relay.clients[1]).handlers.onOpen();
    expect(requireValue(relay.clients[1]).sent).toEqual([{ t: "h", r: "czuupyef", k: KEY }]);

    requireValue(relay.clients[1]).handlers.onFrame({ t: "r", r: "aaaaaaaa", k: KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    expect(lastBadge()?.icon).toBe("headphones");
    expect(ctx.memory.get("room")).toMatchObject({ phase: "hosting", shareUrl: "https://ytmdesktopplus.com/r/aaaaaaaa" });

    expect(logged()).toContain("Room hosting");
    expect(logged().filter((line) => line.includes("czuupyef") || line.includes("aaaaaaaa"))).toEqual([]);
  });

  it("regrows the automatic room after the relay refuses it outright", async () => {
    const { lastBadge, logged } = await hostAutomatically();
    requireValue(relay.clients[0]).handlers.onOpen();
    requireValue(relay.clients[0]).handlers.onFrame({ t: "r", r: "czuupyef", k: KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    expect(lastBadge()?.icon).toBe("headphones");
    requireValue(relay.clients[0]).handlers.onClose();
    vi.advanceTimersByTime(1000);
    requireValue(relay.clients[1]).handlers.onOpen();
    requireValue(relay.clients[1]).handlers.onFrame({ t: "e", m: "server busy" });
    expect(lastBadge()).toBeNull();
    expect(logged()).toContain("Room failed: server busy");

    vi.advanceTimersByTime(4999);
    expect(relay.clients).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(relay.clients).toHaveLength(3);
    expect(requireValue(relay.clients[2]).url).toBe("wss://ytmdesktopplus.com/relay");
    requireValue(relay.clients[2]).handlers.onOpen();
    requireValue(relay.clients[2]).handlers.onFrame({ t: "r", r: "aaaaaaaa", k: KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    expect(lastBadge()?.icon).toBe("headphones");
  });

  it("redials the room and the audio when the system wakes up, until the addon is destroyed", async () => {
    resume.listeners = [];
    const { instance } = await hostAutomatically();
    requireValue(relay.clients[0]).handlers.onOpen();
    requireValue(relay.clients[0]).handlers.onFrame({ t: "r", r: "czuupyef", k: KEY, u: "abcdef", role: 0, n: 0, c: 1 });
    expect(resume.listeners).toHaveLength(1);

    requireValue(resume.listeners[0]).call(resume.listeners);

    expect(relay.clients).toHaveLength(2);
    expect(requireValue(relay.clients[1]).url).toBe("wss://ytmdesktopplus.com/relay?ytmdproom=czuupyef");
    expect(uplink.instance.reconnectNow).toHaveBeenCalledTimes(1);

    instance.destroy();
    expect(resume.listeners).toHaveLength(0);
  });

  it("hands the uplink the relay clock and re-arms it each time hosting comes back", async () => {
    await hostAutomatically();
    requireValue(relay.clients[0]).handlers.onOpen();
    requireValue(relay.clients[0]).handlers.onFrame({ t: "r", r: "czuupyef", k: KEY, u: "abcdef", role: 0, n: 0, c: Date.now() + 4_000 });

    expect(uplink.instance.setClockOffset).toHaveBeenLastCalledWith(expect.any(Number));
    expect(vi.mocked(uplink.instance.setClockOffset).mock.calls.at(-1)?.[0]).toBeGreaterThan(3_000);
    expect(uplink.instance.rearm).toHaveBeenCalledTimes(1);

    requireValue(relay.clients[0]).handlers.onClose();
    vi.advanceTimersByTime(1000);
    requireValue(relay.clients[1]).handlers.onOpen();
    requireValue(relay.clients[1]).handlers.onFrame({ t: "r", r: "czuupyef", k: KEY, u: "abcdef", role: 0, n: 0, c: Date.now() + 4_000 });

    expect(uplink.instance.rearm).toHaveBeenCalledTimes(2);
  });

  it("stops touching the relay once the addon is destroyed", async () => {
    const { instance } = await hostAutomatically();
    requireValue(relay.clients[0]).handlers.onOpen();
    requireValue(relay.clients[0]).handlers.onFrame({ t: "e", m: "server busy" });
    instance.destroy();
    vi.advanceTimersByTime(600_000);
    expect(relay.clients).toHaveLength(1);
  });
});
