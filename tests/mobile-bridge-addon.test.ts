import { afterEach, describe, expect, it, vi } from "vitest";
import type { AddonContext } from "../src/main/addons/context";
import type { RemoteTrackActivity } from "../src/main/integrations/discord-presence";
import mobileBridgeAddon from "../src/addons/bundled/mobile-bridge";
import { VideoState } from "../src/main/player-state-store";

function fakeContext(overrides: { settings?: Record<string, unknown>; history?: unknown } = {}) {
  const unsubscribe = () => {};
  const settings: Record<string, unknown> = { discordMirrorEnabled: true, ...overrides.settings };
  const captured: {
    remoteProvider: (() => RemoteTrackActivity | undefined) | null;
    stateListener: ((state: unknown) => void) | null;
    loadedCallbacks: (() => void)[];
    invocations: { name: string; arg: unknown }[];
    badges: unknown[];
  } = { remoteProvider: null, stateListener: null, loadedCallbacks: [], invocations: [], badges: [] };

  const ctx = {
    manifest: mobileBridgeAddon.manifest,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    paths: { data: "" },
    app: { version: "0.0.0" },
    settings: {
      registerDefaults: vi.fn(),
      get: vi.fn((key: string) => settings[key]),
      set: vi.fn(),
      onDidChange: vi.fn(() => unsubscribe),
      registerSettingsUI: vi.fn()
    },
    memory: { get: vi.fn(), set: vi.fn() },
    ytmview: {
      registerScript: vi.fn(),
      runScript: vi.fn(),
      invokeScript: vi.fn((name: string, arg?: unknown) => {
        captured.invocations.push({ name, arg });
        if (name === "gethistory") return Promise.resolve(overrides.history ?? []);
        return Promise.resolve(true);
      }),
      onLoaded: vi.fn((callback: () => void) => {
        captured.loadedCallbacks.push(callback);
        return unsubscribe;
      }),
      insertCSS: vi.fn(),
      watchCSSFile: vi.fn()
    },
    player: {
      getState: vi.fn(() => ({ trackState: VideoState.Unknown, videoDetails: null, hasFullMetadata: false })),
      onStateChanged: vi.fn((listener: (state: unknown) => void) => {
        captured.stateListener = listener;
        return unsubscribe;
      })
    },
    playback: { cueTrack: vi.fn(), sendPlaybackCommand: vi.fn() },
    ipc: { handle: vi.fn(() => unsubscribe), on: vi.fn(() => unsubscribe) },
    notifications: { show: vi.fn() },
    windows: { create: vi.fn() },
    deepLinks: { register: vi.fn(() => unsubscribe) },
    discord: {
      registerButtonsProvider: vi.fn(() => unsubscribe),
      registerRemoteActivityProvider: vi.fn((provider: () => RemoteTrackActivity | undefined) => {
        captured.remoteProvider = provider;
        return unsubscribe;
      }),
      refreshActivity: vi.fn()
    },
    titlebar: {
      setBadge: vi.fn((badge: unknown) => captured.badges.push(badge)),
      onBadgeClick: vi.fn(() => unsubscribe)
    },
    coreSettings: { get: vi.fn(() => false), onDidChange: vi.fn(() => unsubscribe) },
    coreMemory: { get: vi.fn(() => null), set: vi.fn() }
  } as unknown as AddonContext;

  return { ctx, captured, settings };
}

const phoneTrack = { videoId: "phone1", title: "Phone Song", author: "Phone Artist", thumbnailUrl: "https://example.invalid/a.jpg" };

describe("mobile-bridge bundled addon", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("declares the expected manifest", () => {
    expect(mobileBridgeAddon.manifest.id).toBe("mobile-bridge");
    expect(mobileBridgeAddon.manifest.defaultEnabled).toBe(false);
  });

  it("registers defaults, scripts, css and the presence provider on activate", async () => {
    vi.useFakeTimers();
    const { ctx } = fakeContext();
    const instance = await mobileBridgeAddon.activate(ctx);

    expect(ctx.settings.registerDefaults).toHaveBeenCalledWith({ discordMirrorEnabled: true });
    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("gethistory", expect.any(String));
    expect(ctx.ytmview.registerScript).toHaveBeenCalledWith("banner", expect.any(String));
    expect(ctx.ytmview.insertCSS).toHaveBeenCalledTimes(1);
    expect(ctx.discord.registerRemoteActivityProvider).toHaveBeenCalledTimes(1);
    await instance?.destroy?.();
  });

  it("mirrors a phone track to banner, badge and presence, and local playback clears it", async () => {
    vi.useFakeTimers();
    const { ctx, captured } = fakeContext({ history: [phoneTrack] });
    const instance = await mobileBridgeAddon.activate(ctx);

    captured.loadedCallbacks.forEach(callback => callback());
    await vi.advanceTimersByTimeAsync(50);

    const shows = captured.invocations.filter(call => call.name === "banner");
    expect(shows.at(-1)?.arg).toEqual({ action: "show", track: phoneTrack });
    expect(captured.badges.at(-1)).toMatchObject({ icon: "smartphone", active: true });
    expect(captured.remoteProvider?.()).toMatchObject({ title: "Phone Song", author: "Phone Artist", smallText: "Playing on your phone" });
    expect(ctx.discord.refreshActivity).toHaveBeenCalled();

    captured.stateListener?.({ trackState: VideoState.Playing, videoDetails: { id: "localvid" }, hasFullMetadata: true });
    expect(captured.invocations.filter(call => call.name === "banner").at(-1)?.arg).toEqual({ action: "hide" });
    expect(captured.badges.at(-1)).toBeNull();
    expect(captured.remoteProvider?.()).toBeUndefined();
    await instance?.destroy?.();
  });

  it("keeps the presence provider silent when the discord toggle is off", async () => {
    vi.useFakeTimers();
    const { ctx, captured } = fakeContext({ history: [phoneTrack], settings: { discordMirrorEnabled: false } });
    const instance = await mobileBridgeAddon.activate(ctx);

    captured.loadedCallbacks.forEach(callback => callback());
    await vi.advanceTimersByTimeAsync(50);

    expect(captured.invocations.filter(call => call.name === "banner").at(-1)?.arg).toEqual({ action: "show", track: phoneTrack });
    expect(captured.remoteProvider?.()).toBeUndefined();
    await instance?.destroy?.();
  });

  it("clears every surface on destroy", async () => {
    vi.useFakeTimers();
    const { ctx, captured } = fakeContext({ history: [phoneTrack] });
    const instance = await mobileBridgeAddon.activate(ctx);
    captured.loadedCallbacks.forEach(callback => callback());
    await vi.advanceTimersByTimeAsync(50);

    await instance?.destroy?.();
    expect(captured.invocations.filter(call => call.name === "banner").at(-1)?.arg).toEqual({ action: "hide" });
    expect(captured.badges.at(-1)).toBeNull();
  });
});
