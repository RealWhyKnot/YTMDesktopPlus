import { describe, expect, it, vi } from "vitest";

import blendAddon from "../src/addons/bundled/blend";
import { fakeAddonContext, makePlayerState } from "./helpers/fake-addon-context";
import { RepeatMode, type AddonInstance, type PlayerQueue, type PlayerQueueItem } from "../src/shared/addons/sdk";

function makeQueue(overrides: Partial<PlayerQueue> = {}): PlayerQueue {
  const item = { thumbnails: [], title: "t", author: "a", duration: "0:00", selected: true, videoId: "v", counterparts: null } as PlayerQueueItem;
  return {
    automixItems: [],
    autoplay: true,
    isGenerating: false,
    isInfinite: false,
    items: [item, { ...item, selected: false, videoId: "w" }],
    repeatMode: RepeatMode.None,
    selectedItemIndex: 0,
    ...overrides
  };
}

function harness(options: { settings?: Record<string, unknown>; queue?: PlayerQueue | null; adPlaying?: boolean } = {}) {
  const bag = fakeAddonContext({ manifest: blendAddon.manifest, settings: { seconds: 5, ...options.settings } });
  bag.ctx.player.getQueue = vi.fn(() => (options.queue === undefined ? makeQueue() : options.queue));
  bag.ctx.player.getState = vi.fn(() => makePlayerState({ adPlaying: options.adPlaying ?? false }));
  return bag;
}

const lastArg = (bag: ReturnType<typeof harness>) => bag.captured.invocations.at(-1)?.arg as Record<string, unknown> | undefined;

describe("blend bundled addon", () => {
  it("ships disabled, like every other bundled addon", () => {
    expect(blendAddon.manifest.defaultEnabled).toBe(false);
    expect(blendAddon.manifest.id).toBe("blend");
  });

  it("exposes exactly one setting", async () => {
    const bag = harness();
    await blendAddon.activate(bag.ctx);
    const fields = bag.captured.sections.flatMap(section => section.fields);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ key: "seconds", type: "number", display: "slider", min: 1, max: 12 });
    expect(bag.settings.seconds).toBe(5);
  });

  it("registers the engine and its teardown script", async () => {
    const bag = harness();
    await blendAddon.activate(bag.ctx);
    expect(Object.keys(bag.captured.scripts).sort()).toEqual(["blend", "blend-disable"]);
  });

  it("reads hasNext off the real queue at activate instead of assuming one", async () => {
    const onLastItem = makeQueue({ selectedItemIndex: 1 });
    const bag = harness({ queue: onLastItem });
    await blendAddon.activate(bag.ctx);
    bag.fireLoaded();
    await vi.waitFor(() => expect(bag.captured.invocations.length).toBeGreaterThan(0));
    expect(lastArg(bag)?.hasNext).toBe(false);
  });

  it("counts automix and infinite queues as having a next track", async () => {
    const bag = harness({ queue: makeQueue({ selectedItemIndex: 1, isInfinite: true }) });
    await blendAddon.activate(bag.ctx);
    bag.fireLoaded();
    await vi.waitFor(() => expect(lastArg(bag)?.hasNext).toBe(true));
  });

  it("sends the settings and player state the page cannot see", async () => {
    const bag = harness({ settings: { seconds: 8 }, adPlaying: true });
    await blendAddon.activate(bag.ctx);
    bag.fireLoaded();
    await vi.waitFor(() => expect(lastArg(bag)).toBeDefined());
    expect(lastArg(bag)).toEqual({ seconds: 8, repeatOne: false, adPlaying: true, hasNext: true });
  });

  it("re-applies when the setting, the ads, the repeat mode or the queue change", async () => {
    const bag = harness();
    await blendAddon.activate(bag.ctx);

    bag.settings.seconds = 7;
    await bag.captured.settingsListeners.seconds?.(7, 5);
    await vi.waitFor(() => expect(lastArg(bag)?.seconds).toBe(7));

    bag.emitPlayerEvent("adStateChanged", { adPlaying: true });
    await vi.waitFor(() => expect(lastArg(bag)?.adPlaying).toBe(true));

    bag.emitPlayerEvent("repeatModeChanged", { repeatMode: RepeatMode.One });
    await vi.waitFor(() => expect(lastArg(bag)?.repeatOne).toBe(true));

    bag.emitPlayerEvent("queueChanged", { queue: makeQueue({ selectedItemIndex: 1 }) });
    await vi.waitFor(() => expect(lastArg(bag)?.hasNext).toBe(false));
  });

  it("ignores a queue change that leaves hasNext alone", async () => {
    const bag = harness();
    await blendAddon.activate(bag.ctx);
    bag.fireLoaded();
    await vi.waitFor(() => expect(bag.captured.invocations.length).toBe(1));
    bag.emitPlayerEvent("queueChanged", { queue: makeQueue() });
    expect(bag.captured.invocations).toHaveLength(1);
  });

  it("logs what the engine decided", async () => {
    const bag = harness();
    await blendAddon.activate(bag.ctx);
    bag.emitViewMessage("diag", { event: "blend", kind: "skip", blends: 3 });
    expect(bag.ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("blend blend"));
    expect(bag.ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("kind=skip"));
    expect(bag.ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("blends=3"));
  });

  it("says so when the page has no audio graph yet", async () => {
    const bag = fakeAddonContext({ manifest: blendAddon.manifest, settings: { seconds: 5 }, invokeScript: async () => false });
    bag.ctx.player.getQueue = vi.fn(() => makeQueue());
    await blendAddon.activate(bag.ctx);
    bag.fireLoaded();
    await vi.waitFor(() => expect(bag.ctx.log.info).toHaveBeenCalledWith(expect.stringContaining("no audio graph")));
  });

  it("unsubscribes and tears the engine down on destroy", async () => {
    const bag = harness();
    const instance = await blendAddon.activate(bag.ctx);
    await (instance as AddonInstance).destroy?.();
    expect(bag.unsubscribe).toHaveBeenCalled();
    expect(bag.ctx.ytmview.runScript).toHaveBeenCalledWith("blend-disable");
  });
});
