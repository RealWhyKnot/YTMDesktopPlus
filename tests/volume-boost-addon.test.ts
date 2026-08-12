import { describe, expect, it, vi } from "vitest";
import volumeBoostAddon from "../src/addons/bundled/volume-boost";
import { fakeAddonContext } from "./helpers/fake-addon-context";

function fakeContext(overrides: { settings?: Record<string, unknown>; applied?: unknown } = {}) {
  return fakeAddonContext({
    manifest: volumeBoostAddon.manifest,
    settings: { ceiling: 200, limiter: true, ...overrides.settings },
    invokeScript: async () => overrides.applied ?? true
  });
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

    expect(captured.loadedCallbacks).toHaveLength(1);
    await captured.loadedCallbacks[0]();

    expect(captured.invocations).toEqual([{ name: "boost", arg: { ceiling: 300, limiter: false } }]);
  });

  it("reapplies when either setting changes", async () => {
    const { ctx, captured, settings } = fakeContext();
    volumeBoostAddon.activate(ctx);

    settings.ceiling = 500;
    await captured.settingsListeners.ceiling();
    settings.limiter = false;
    await captured.settingsListeners.limiter();

    expect(captured.invocations.map(invocation => invocation.arg)).toEqual([
      { ceiling: 500, limiter: true },
      { ceiling: 500, limiter: false }
    ]);
  });

  it("says so in the log when the page has no audio graph to attach to", async () => {
    const { ctx, captured } = fakeContext({ applied: false });
    volumeBoostAddon.activate(ctx);
    await captured.loadedCallbacks[0]();
    expect(ctx.log.info).toHaveBeenCalled();
  });

  it("survives the page rejecting the script rather than taking the addon down", async () => {
    const { ctx, captured } = fakeContext();
    (ctx.ytmview.invokeScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no such script"));
    volumeBoostAddon.activate(ctx);
    await expect(captured.loadedCallbacks[0]()).resolves.not.toThrow();
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
