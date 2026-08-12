import { describe, expect, it, vi } from "vitest";
import roomsAddon from "../src/addons/bundled/rooms";
import { cleanAudioPackets } from "../src/addons/bundled/rooms/audio-capture";
import { fakeAddonContext } from "./helpers/fake-addon-context";

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
    expect(channels).toEqual(["closeWindow", "control", "grant", "host", "join", "leave", "openWindow", "resume"]);

    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("enable", expect.any(String));
    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("disable", expect.any(String));
  });

  it("listens for the capture traffic its page script posts", async () => {
    const { ctx, captured } = fakeAddonContext({ manifest: roomsAddon.manifest });
    await roomsAddon.activate(ctx);

    expect(Object.keys(captured.messageCallbacks).sort()).toEqual(["audioChunks", "captureStatus"]);
    // Malformed payloads never reach the publisher.
    expect(() => captured.messageCallbacks["audioChunks"][0]("not packets")).not.toThrow();
    expect(() => captured.messageCallbacks["captureStatus"][0](null)).not.toThrow();
  });
});

describe("cleanAudioPackets", () => {
  it("keeps well formed packets and drops the rest", () => {
    const good = { t: 12, d: new ArrayBuffer(4) };
    const cleaned = cleanAudioPackets([good, { t: "x", d: new ArrayBuffer(1) }, { t: 1 }, null]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].timestampUs).toBe(12);
    expect(cleaned[0].payload).toBeInstanceOf(Uint8Array);

    expect(cleanAudioPackets("nope")).toEqual([]);
    expect(cleanAudioPackets(undefined)).toEqual([]);
  });
});
