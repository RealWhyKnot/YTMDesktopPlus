import { describe, expect, it } from "vitest";
import djAddon from "../src/addons/bundled/dj";
import { fakeAddonContext } from "./helpers/fake-addon-context";
import { RepeatMode, type PlayerQueue } from "../src/shared/addons/sdk";

function fakeContext(overrides: { settings?: Record<string, unknown> } = {}) {
  return fakeAddonContext({
    manifest: djAddon.manifest,
    settings: { fadeOut: 5, fadeIn: 1.5, curve: 0, fadeOnManualSkip: true, fadeOnRepeatOne: false, ...overrides.settings }
  });
}

function makeQueue(overrides: Partial<PlayerQueue> = {}): PlayerQueue {
  return {
    automixItems: [],
    autoplay: false,
    isGenerating: false,
    isInfinite: false,
    items: [],
    repeatMode: RepeatMode.None,
    selectedItemIndex: 0,
    ...overrides
  };
}

describe("dj bundled addon", () => {
  it("ships disabled, since it changes how playback sounds", () => {
    expect(djAddon.manifest.defaultEnabled).toBe(false);
  });

  it("registers both page scripts", () => {
    const { ctx, captured } = fakeContext();
    djAddon.activate(ctx);
    expect(Object.keys(captured.scripts).sort()).toEqual(["crossfade", "crossfade-disable"]);
  });

  it("offers number-valued curve options, which is all a select field accepts", () => {
    const { ctx, captured } = fakeContext();
    djAddon.activate(ctx);
    const fields = captured.sections.flatMap(section => section.fields);
    const curve = fields.find(field => field.key === "curve");
    const values = curve?.type === "select" ? curve.options.map(option => option.value) : [];
    expect(values).toEqual([0, 1, 2]);
    expect(values.every(value => typeof value === "number")).toBe(true);
  });

  it("pushes the current settings into the page each time it loads", async () => {
    const { ctx, captured } = fakeContext({ settings: { fadeOut: 8, curve: 1 } });
    djAddon.activate(ctx);
    await captured.loadedCallbacks[0]();
    expect(captured.invocations).toEqual([
      {
        name: "crossfade",
        arg: {
          enabled: true,
          fadeOutS: 8,
          fadeInS: 1.5,
          curve: 1,
          fadeOnManualSkip: true,
          fadeOnRepeatOne: false,
          repeatOne: false,
          adPlaying: false,
          hasNext: true
        }
      }
    ]);
  });

  it("reapplies with repeatOne when the repeat mode flips to one", async () => {
    const { ctx, captured, emitPlayerEvent } = fakeContext();
    djAddon.activate(ctx);
    emitPlayerEvent("repeatModeChanged", { repeatMode: RepeatMode.One });
    await Promise.resolve();
    expect(captured.invocations.at(-1)?.arg).toMatchObject({ repeatOne: true });
  });

  it("reapplies when an ad starts", async () => {
    const { ctx, captured, emitPlayerEvent } = fakeContext();
    djAddon.activate(ctx);
    emitPlayerEvent("adStateChanged", { adPlaying: true });
    await Promise.resolve();
    expect(captured.invocations.at(-1)?.arg).toMatchObject({ adPlaying: true });
  });

  it("reports no next track only when the queue is exhausted and finite", async () => {
    const { ctx, captured, emitPlayerEvent } = fakeContext();
    djAddon.activate(ctx);

    emitPlayerEvent("queueChanged", { queue: makeQueue({ items: [{} as never], selectedItemIndex: 0 }) });
    await Promise.resolve();
    expect(captured.invocations.at(-1)?.arg).toMatchObject({ hasNext: false });

    emitPlayerEvent("queueChanged", { queue: makeQueue({ items: [{} as never, {} as never], selectedItemIndex: 0 }) });
    await Promise.resolve();
    expect(captured.invocations.at(-1)?.arg).toMatchObject({ hasNext: true });
  });

  it("does not reapply when the queue changes but next-availability does not", async () => {
    const { ctx, captured, emitPlayerEvent } = fakeContext();
    djAddon.activate(ctx);
    const queue = makeQueue({ items: [{} as never, {} as never], selectedItemIndex: 0 });
    emitPlayerEvent("queueChanged", { queue });
    await Promise.resolve();
    const count = captured.invocations.length;
    emitPlayerEvent("queueChanged", { queue });
    await Promise.resolve();
    expect(captured.invocations.length).toBe(count);
  });

  it("survives the page rejecting the script rather than taking the addon down", async () => {
    const { ctx, captured } = fakeAddonContext({
      manifest: djAddon.manifest,
      invokeScript: async () => {
        throw new Error("no such script");
      }
    });
    djAddon.activate(ctx);
    await expect(captured.loadedCallbacks[0]()).resolves.not.toThrow();
    expect(ctx.log.warn).toHaveBeenCalled();
  });

  it("tears the page engine down and drops listeners on destroy", () => {
    const { ctx, unsubscribe } = fakeContext();
    const instance = djAddon.activate(ctx);
    (instance as { destroy: () => void }).destroy();
    expect(ctx.ytmview.runScript).toHaveBeenCalledWith("crossfade-disable");
    expect(unsubscribe).toHaveBeenCalledTimes(9);
  });
});
