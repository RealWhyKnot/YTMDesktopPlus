import { describe, expect, it, vi } from "vitest";
import type { AddonContext } from "../src/main/addons/context";
import type { AddonSettingsSection } from "../src/shared/addons/types";
import volumeBoostAddon from "../src/addons/bundled/volume-boost";

function fakeContext(overrides: { settings?: Record<string, unknown>; applied?: unknown } = {}) {
  const unsubscribe = vi.fn();
  const settings: Record<string, unknown> = { ceiling: 200, limiter: true, ...overrides.settings };
  const captured: {
    invocations: { name: string; arg: unknown }[];
    loaded: (() => void)[];
    changeListeners: Record<string, () => void>;
    sections: AddonSettingsSection[];
    cssRemoved: number;
  } = { invocations: [], loaded: [], changeListeners: {}, sections: [], cssRemoved: 0 };

  const ctx = {
    manifest: volumeBoostAddon.manifest,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    paths: { data: "" },
    app: { version: "0.0.0" },
    settings: {
      registerDefaults: vi.fn(),
      get: vi.fn((key: string) => settings[key]),
      set: vi.fn(),
      onDidChange: vi.fn((key: string, listener: () => void) => {
        captured.changeListeners[key] = listener;
        return unsubscribe;
      }),
      registerSettingsUI: vi.fn((sections: AddonSettingsSection[]) => captured.sections.push(...sections))
    },
    memory: { get: vi.fn(), set: vi.fn() },
    ytmview: {
      registerScript: vi.fn(),
      runScript: vi.fn(),
      invokeScript: vi.fn((name: string, arg?: unknown) => {
        captured.invocations.push({ name, arg });
        return Promise.resolve(overrides.applied ?? true);
      }),
      onLoaded: vi.fn((callback: () => void) => {
        captured.loaded.push(callback);
        return unsubscribe;
      }),
      insertCSS: vi.fn(() => ({ remove: () => captured.cssRemoved++ })),
      watchCSSFile: vi.fn()
    },
    player: { getState: vi.fn(), onStateChanged: vi.fn(() => unsubscribe) },
    playback: { cueTrack: vi.fn(), sendPlaybackCommand: vi.fn() },
    ipc: { handle: vi.fn(() => unsubscribe), on: vi.fn(() => unsubscribe) },
    notifications: { show: vi.fn() },
    windows: { create: vi.fn() },
    deepLinks: { register: vi.fn(() => unsubscribe) },
    discord: { registerButtonsProvider: vi.fn(() => unsubscribe), registerRemoteActivityProvider: vi.fn(() => unsubscribe), refreshActivity: vi.fn() },
    titlebar: { setBadge: vi.fn(), onBadgeClick: vi.fn(() => unsubscribe) },
    coreSettings: { get: vi.fn(), onDidChange: vi.fn(() => unsubscribe) },
    coreMemory: { get: vi.fn(), set: vi.fn() }
  } as unknown as AddonContext;

  return { ctx, captured, settings, unsubscribe };
}

describe("volume-boost bundled addon", () => {
  it("ships disabled, since it changes how loud the app can get", () => {
    expect(volumeBoostAddon.manifest.defaultEnabled).toBe(false);
  });

  it("defaults to 200% with the limiter on", () => {
    const { ctx } = fakeContext();
    volumeBoostAddon.activate(ctx);
    expect(ctx.settings.registerDefaults).toHaveBeenCalledWith({ ceiling: 200, limiter: true });
  });

  it("offers only number-valued ceilings, which is all a select field accepts", () => {
    const { ctx, captured } = fakeContext();
    volumeBoostAddon.activate(ctx);

    const fields = captured.sections.flatMap(section => section.fields);
    const ceiling = fields.find(field => field.key === "ceiling");
    expect(ceiling?.type).toBe("select");
    const values = ceiling?.type === "select" ? ceiling.options.map(option => option.value) : [];
    expect(values).toEqual([150, 200, 300, 500]);
    expect(values.every(value => typeof value === "number")).toBe(true);
    expect(fields.find(field => field.key === "limiter")?.type).toBe("toggle");
  });

  it("pushes the current settings into the page each time it loads", async () => {
    const { ctx, captured } = fakeContext({ settings: { ceiling: 300, limiter: false } });
    volumeBoostAddon.activate(ctx);

    expect(captured.loaded).toHaveLength(1);
    await captured.loaded[0]();

    expect(captured.invocations).toEqual([{ name: "boost", arg: { ceiling: 300, limiter: false } }]);
  });

  it("reapplies when either setting changes", async () => {
    const { ctx, captured, settings } = fakeContext();
    volumeBoostAddon.activate(ctx);

    settings.ceiling = 500;
    await captured.changeListeners.ceiling();
    settings.limiter = false;
    await captured.changeListeners.limiter();

    expect(captured.invocations.map(invocation => invocation.arg)).toEqual([
      { ceiling: 500, limiter: true },
      { ceiling: 500, limiter: false }
    ]);
  });

  it("says so in the log when the page has no audio graph to attach to", async () => {
    const { ctx, captured } = fakeContext({ applied: false });
    volumeBoostAddon.activate(ctx);
    await captured.loaded[0]();
    expect(ctx.log.info).toHaveBeenCalled();
  });

  it("survives the page rejecting the script rather than taking the addon down", async () => {
    const { ctx, captured } = fakeContext();
    (ctx.ytmview.invokeScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no such script"));
    volumeBoostAddon.activate(ctx);
    await expect(captured.loaded[0]()).resolves.not.toThrow();
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("drops its stylesheet and listeners on destroy", () => {
    const { ctx, captured, unsubscribe } = fakeContext();
    const instance = volumeBoostAddon.activate(ctx);
    (instance as { destroy: () => void }).destroy();

    expect(captured.cssRemoved).toBe(1);
    expect(unsubscribe).toHaveBeenCalledTimes(3);
  });
});
