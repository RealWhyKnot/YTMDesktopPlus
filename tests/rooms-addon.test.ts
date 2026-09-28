import { describe, expect, it, vi } from "vitest";
import roomsAddon from "../src/addons/bundled/rooms";
import type { AudioUplinkDeps } from "../src/main/media/audio-uplink";
import { VideoState } from "../src/shared/addons/sdk";
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
