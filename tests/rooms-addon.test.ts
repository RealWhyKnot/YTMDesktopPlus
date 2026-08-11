import { describe, expect, it, vi } from "vitest";
import type { AddonContext } from "../src/main/addons/context";
import roomsAddon from "../src/addons/bundled/rooms";

vi.mock("electron", () => ({
  ipcMain: { on: vi.fn(), handle: vi.fn(), removeListener: vi.fn(), removeHandler: vi.fn() }
}));

function fakeContext() {
  const unsubscribe = () => {};
  return {
    manifest: roomsAddon.manifest,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    paths: { data: "" },
    app: { version: "0.0.0" },
    settings: {
      registerDefaults: vi.fn(),
      get: vi.fn(() => null),
      set: vi.fn(),
      onDidChange: vi.fn(() => unsubscribe),
      registerSettingsUI: vi.fn()
    },
    memory: { get: vi.fn(), set: vi.fn() },
    ytmview: {
      registerScript: vi.fn(),
      runScript: vi.fn(),
      onLoaded: vi.fn(() => unsubscribe),
      insertCSS: vi.fn(),
      watchCSSFile: vi.fn()
    },
    player: { getState: vi.fn(() => null), onStateChanged: vi.fn(() => unsubscribe) },
    playback: { cueTrack: vi.fn(), sendPlaybackCommand: vi.fn() },
    ipc: { handle: vi.fn(() => unsubscribe), on: vi.fn(() => unsubscribe) },
    notifications: { show: vi.fn() },
    windows: { create: vi.fn() },
    deepLinks: { register: vi.fn(() => unsubscribe) },
    discord: { registerButtonsProvider: vi.fn(() => unsubscribe), refreshActivity: vi.fn() },
    titlebar: { setBadge: vi.fn(), onBadgeClick: vi.fn(() => unsubscribe) },
    coreSettings: { get: vi.fn(() => false), onDidChange: vi.fn(() => unsubscribe) },
    coreMemory: { get: vi.fn(() => null), set: vi.fn() }
  } as unknown as AddonContext;
}

describe("rooms bundled addon", () => {
  it("declares the expected manifest", () => {
    expect(roomsAddon.manifest.id).toBe("rooms");
    expect(roomsAddon.manifest.defaultEnabled).toBe(true);
    expect(roomsAddon.manifest.version).toBe("1.0.0");
  });

  it("registers defaults, settings UI and the room deep link on activate", async () => {
    const ctx = fakeContext();
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
