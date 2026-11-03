import { requireValue } from "./helpers/require-value";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerEventMap } from "~shared/addons/sdk";
import { fakeServices, fakeAddonEvent, fakeAddonView } from "./helpers/fake-services";
import { bootWithContext } from "./helpers/boot-addon-context";
import { AddonCssHandle } from "../src/main/addons/css";

afterEach(() => vi.restoreAllMocks());

describe("AddonContext", () => {
  it("namespaces settings per addon with defaults that never clobber", async () => {
    const fixture = fakeServices();
    fixture.stored.addons.settings.sample = { kept: "user-value" };
    const { ctx } = await bootWithContext(fixture);

    ctx.settings.registerDefaults({ kept: "default", fresh: 42 });
    expect(ctx.settings.get("kept")).toBe("user-value");
    expect(ctx.settings.get("fresh")).toBe(42);

    ctx.settings.set("fresh", 43);
    expect(fixture.stored.addons.settings.sample.fresh).toBe(43);
  });

  it("delivers settings changes with previous and next values", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);
    const seen: unknown[][] = [];
    ctx.settings.onDidChange("volume", (next, prev) => seen.push([next, prev]));

    ctx.settings.set("volume", 5);
    ctx.settings.set("volume", 5);
    ctx.settings.set("volume", 7);
    expect(seen).toEqual([
      [5, undefined],
      [7, 5],
    ]);
  });

  it("registers page scripts under the addon namespace", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);
    ctx.ytmview.registerScript("enable", "() => {}");
    expect(requireValue(fixture.registeredScripts.get("addon:sample")).get("enable")).toBe("() => {}");
  });

  it("serves innertube requests through the host page script", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);

    expect(requireValue(fixture.registeredScripts.get("addon-host")).get("innertubeRequest")).toContain("/youtubei/v1/");

    fixture.services.getYtmView = fakeAddonView;
    await ctx.innertube.request("browse", { browseId: "FEmusic_history" });
    expect(fixture.services.invokeYtmScript).toHaveBeenCalledWith("addon-host", "innertubeRequest", {
      endpoint: "browse",
      body: { browseId: "FEmusic_history" },
    });
  });

  it("runs loaded callbacks and contains one that throws", async () => {
    const fixture = fakeServices();
    const survivor = vi.fn();
    const { manager, ctx } = await bootWithContext(fixture);
    ctx.ytmview.onLoaded(() => {
      throw new Error("page hook blew up");
    });
    ctx.ytmview.onLoaded(survivor);

    manager.notifyYtmViewLoaded();
    expect(survivor).toHaveBeenCalledOnce();
  });

  it("guards addon ipc channels against senders outside the app", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);
    const listener = vi.fn();
    ctx.ipc.handle("ping", listener);

    const handler = fixture.ipcHandlers.get("addon:sample:ping");
    expect(handler).toBeDefined();

    fixture.setAppSender(false);
    requireValue(handler)(fakeAddonEvent());
    expect(listener).not.toHaveBeenCalled();

    fixture.setAppSender(true);
    requireValue(handler)(fakeAddonEvent());
    expect(listener).toHaveBeenCalledOnce();
  });

  it("contains a throwing settings listener and records it on the descriptor", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    ctx.settings.onDidChange("volume", () => {
      throw new Error("listener blew up");
    });

    ctx.settings.set("volume", 5);

    const descriptor = manager.descriptors()[0];
    expect(requireValue(descriptor).state).toBe("active");
    expect(requireValue(descriptor).lastError).toContain("listener blew up");
    expect(requireValue(descriptor).lastError).toContain("settings.onDidChange");
  });

  it("contains a throwing player listener", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    ctx.player.onStateChanged(() => {
      throw new Error("state handler down");
    });

    const registered = requireValue(vi.mocked(fixture.services.player.addEventListener).mock.calls[0])[0];
    expect(() => {
      Reflect.apply(requireValue(registered), undefined, [{}]);
    }).not.toThrow();
    expect(requireValue(manager.descriptors()[0]).lastError).toContain("state handler down");
  });

  it("routes page messages to the addon and contains a throwing handler", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    const seen: unknown[] = [];
    ctx.ytmview.onMessage("ping", (payload) => seen.push(payload));
    ctx.ytmview.onMessage("broken", () => {
      throw new Error("message boom");
    });

    expect(manager.handleViewMessage("sample", "ping", { value: 1 })).toBe(true);
    expect(seen).toEqual([{ value: 1 }]);

    expect(manager.handleViewMessage("sample", "silent", null)).toBe(false);
    expect(manager.handleViewMessage("other", "ping", null)).toBe(false);

    expect(() => manager.handleViewMessage("sample", "broken", null)).not.toThrow();
    expect(requireValue(manager.descriptors()[0]).lastError).toContain("message boom");
  });

  it("serves discord enablement through the services bag", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);

    expect(ctx.discord.isEnabled()).toBe(false);
    ctx.discord.onEnabledChanged(() => {
      return undefined;
    });
    expect(fixture.services.discord.onEnabledChanged).toHaveBeenCalledOnce();
  });

  it("delivers typed player events and contains a throwing event callback", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    const seen: unknown[] = [];
    ctx.player.on("trackChanged", (payload) => seen.push(payload));
    ctx.player.on("volumeChanged", () => {
      throw new Error("volume handler down");
    });

    const payload: PlayerEventMap["trackChanged"] = { current: null, previous: null, playlistId: null };
    fixture.playerEvents.emit("trackChanged", payload);
    expect(seen).toEqual([payload]);

    expect(() => fixture.playerEvents.emit("volumeChanged", { volume: 1, muted: false })).not.toThrow();
    expect(requireValue(manager.descriptors()[0]).lastError).toContain("volume handler down");
  });

  it("contains a throwing ipc listener and rethrows from handle for the renderer", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    ctx.ipc.on("poke", () => {
      throw new Error("on failed");
    });
    ctx.ipc.handle("ask", () => {
      throw new Error("handle failed");
    });

    const onListener = fixture.ipcListeners.get("addon:sample:poke");
    expect(() => requireValue(onListener)(fakeAddonEvent())).not.toThrow();
    expect(requireValue(manager.descriptors()[0]).lastError).toContain("on failed");

    const handleListener = fixture.ipcHandlers.get("addon:sample:ask");
    expect(() => requireValue(handleListener)(fakeAddonEvent())).toThrow("handle failed");
    expect(requireValue(manager.descriptors()[0]).lastError).toContain("handle failed");
  });

  it("records a throwing badge click", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    ctx.titlebar.onBadgeClick(() => {
      throw new Error("badge boom");
    });

    expect(manager.handleBadgeClick("sample")).toBe(true);
    expect(requireValue(manager.descriptors()[0]).lastError).toContain("badge boom");
  });

  it("routes named playback methods through the command channel and serves queue reads", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);
    const send = vi.mocked(fixture.services.playback.sendPlaybackCommand);

    ctx.playback.play();
    ctx.playback.setVolume(30);
    ctx.playback.setRepeatMode("ONE");
    ctx.playback.playQueueIndex(2);

    expect(send.mock.calls).toEqual([["play"], ["setVolume", 30], ["repeatMode", "ONE"], ["playQueueIndex", 2]]);
    expect(ctx.player.getQueue()).toBeNull();
    expect(ctx.player.getPlaylistId()).toBeNull();
    await expect(ctx.playback.getPlaylists()).resolves.toEqual([]);
  });

  it("recognizes its own windows by web contents until they close", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    const handle = ctx.windows.create({ entry: "room", width: 100, height: 100 });

    const contents = requireValue(fixture.windows[0]).webContents;
    expect(manager.ownsWebContents(contents)).toBe(true);

    handle.close();
    expect(manager.ownsWebContents(contents)).toBe(false);
  });

  it("drops removed stylesheets instead of re-injecting them on view load", async () => {
    const applications = vi.spyOn(AddonCssHandle.prototype, "apply");
    const applied = () => Promise.all(applications.mock.results.filter((result) => result.type === "return").map((result) => result.value));
    const fixture = fakeServices();
    const inserted: string[] = [];
    fixture.services.getYtmView = () => ({
      webContents: {
        insertCSS: (css: string) => {
          inserted.push(css);
          return Promise.resolve(`key-${inserted.length}`);
        },
        removeInsertedCSS: () => Promise.resolve(undefined),
        send: () => {
          return undefined;
        },
      },
    });
    const { manager, ctx } = await bootWithContext(fixture);

    ctx.ytmview.insertCSS("body { opacity: 1 }");
    const drop = ctx.ytmview.insertCSS("body { opacity: 0 }");
    await applied();
    await drop.remove();

    inserted.length = 0;
    applications.mockClear();
    manager.notifyYtmViewLoaded();
    await applied();

    expect(inserted).toEqual(["body { opacity: 1 }"]);
  });

  it("keeps per-addon memory namespaced", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);
    ctx.memory.set("status", "hosting");
    expect(ctx.memory.get("status")).toBe("hosting");
    expect(fixture.memory.get("addonMemory")).toHaveProperty("sample", { status: "hosting" });
  });
});
