import { describe, expect, it, vi } from "vitest";
import roomsAddon from "../src/addons/bundled/rooms";
import { fakeAddonContext } from "./helpers/fake-addon-context";

vi.mock("electron", () => ({
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeListener: vi.fn(), removeHandler: vi.fn() }
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

    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("enable", expect.any(String));
    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("disable", expect.any(String));
  });
});
