import { describe, expect, it, vi } from "vitest";
import { AddonManager, BundledAddonDefinition } from "../src/main/addons/manager";
import { validateManifest, versionAtLeast } from "../src/main/addons/validate-manifest";
import type { BundledAddonContext } from "../src/main/addons/context";
import type { AddonManifest } from "../src/shared/addons/types";
import { makeManifest as manifest } from "./helpers/fake-addon-context";
import { fakeServices } from "./helpers/fake-services";

describe("AddonManager", () => {
  it("activates bundled addons that default to enabled and skips the rest", async () => {
    const { services, memory } = fakeServices();
    const onActive = vi.fn();
    const offActive = vi.fn();
    const manager = new AddonManager(services);
    manager.registerBundled([
      { manifest: manifest({ id: "on-addon", defaultEnabled: true }), activate: onActive },
      { manifest: manifest({ id: "off-addon" }), activate: offActive }
    ]);
    await manager.boot();

    expect(onActive).toHaveBeenCalledOnce();
    expect(offActive).not.toHaveBeenCalled();
    const runtime = memory.get("addonsRuntime") as { manifest: AddonManifest; state: string }[];
    expect(runtime.find(d => d.manifest.id === "on-addon").state).toBe("active");
    expect(runtime.find(d => d.manifest.id === "off-addon").state).toBe("disabled");
  });

  it("lets the persisted state override the bundled default", async () => {
    const { services } = fakeServices({ "on-addon": { enabled: false } });
    const activate = vi.fn();
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "on-addon", defaultEnabled: true }), activate }]);
    await manager.boot();

    expect(activate).not.toHaveBeenCalled();
  });

  it("contains a throwing addon without breaking its neighbours", async () => {
    const { services, memory } = fakeServices();
    const survivor = vi.fn();
    const manager = new AddonManager(services);
    manager.registerBundled([
      {
        manifest: manifest({ id: "broken", defaultEnabled: true }),
        activate: () => {
          throw new Error("boom");
        }
      },
      { manifest: manifest({ id: "healthy", defaultEnabled: true }), activate: survivor }
    ]);
    await manager.boot();

    expect(survivor).toHaveBeenCalledOnce();
    const runtime = memory.get("addonsRuntime") as { manifest: AddonManifest; state: string; error?: string }[];
    expect(runtime.find(d => d.manifest.id === "broken").state).toBe("error");
    expect(runtime.find(d => d.manifest.id === "broken").error).toContain("boom");
    expect(runtime.find(d => d.manifest.id === "healthy").state).toBe("active");
  });

  it("never loads an addon that needs a newer app", async () => {
    const { services } = fakeServices({}, "2026.803.0");
    const activate = vi.fn();
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "future", defaultEnabled: true, minAppVersion: "2026.900.0" }), activate }]);
    await manager.boot();

    expect(activate).not.toHaveBeenCalled();
    expect(manager.descriptors()[0].state).toBe("incompatible");
  });

  it("rejects duplicate ids at registration", () => {
    const { services } = fakeServices();
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "dup" }), activate: () => {} }]);
    expect(() => manager.registerBundled([{ manifest: manifest({ id: "dup" }), activate: () => {} }])).toThrow(/Duplicate/);
  });

  it("persists intent on setEnabled and flags the restart", async () => {
    const { services, stored } = fakeServices();
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "sample", defaultEnabled: true }), activate: () => {} }] as BundledAddonDefinition[]);
    await manager.boot();

    manager.setEnabled("sample", false);
    expect(stored.addons.states["sample"].enabled).toBe(false);
    const descriptor = manager.descriptors()[0];
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.state).toBe("active");
    expect(descriptor.restartRequired).toBe(true);

    manager.setEnabled("sample", true);
    expect(manager.descriptors()[0].restartRequired).toBe(false);
  });

  it("asks for acknowledgement only for external addons that lack it", async () => {
    const { services } = fakeServices();
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "built-in", defaultEnabled: true }), activate: () => {} }]);
    manager.registerExternal([
      { dir: "x", folderName: "outside", manifest: manifest({ id: "outside" }) },
      { dir: "y", folderName: "trusted", manifest: manifest({ id: "trusted" }) }
    ]);
    await manager.boot();

    expect(manager.needsRiskAcknowledgement("built-in")).toBe(false);
    expect(manager.needsRiskAcknowledgement("outside")).toBe(true);

    manager.acknowledgeRisk("trusted");
    expect(manager.needsRiskAcknowledgement("trusted")).toBe(false);
  });

  it("shuts instances down on quit", async () => {
    const { services } = fakeServices();
    const destroy = vi.fn();
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "sample", defaultEnabled: true }), activate: () => ({ destroy }) }]);
    await manager.boot();
    await manager.shutdown();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("waits for async destroy work and never runs it twice", async () => {
    const { services } = fakeServices();
    let settled = false;
    const destroy = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      settled = true;
    });
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "sample", defaultEnabled: true }), activate: () => ({ destroy }) }]);
    await manager.boot();

    await manager.shutdown();
    expect(settled).toBe(true);

    await manager.shutdown();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

async function bootWithContext(fixture: ReturnType<typeof fakeServices>, id = "sample") {
  let ctx: BundledAddonContext;
  const manager = new AddonManager(fixture.services);
  manager.registerBundled([
    {
      manifest: manifest({ id, defaultEnabled: true }),
      activate: context => {
        ctx = context;
      }
    }
  ]);
  await manager.boot();
  return { manager, ctx };
}

describe("AddonContext", () => {
  it("namespaces settings per addon with defaults that never clobber", async () => {
    const fixture = fakeServices();
    fixture.stored.addons.settings["sample"] = { kept: "user-value" };
    const { ctx } = await bootWithContext(fixture);

    ctx.settings.registerDefaults({ kept: "default", fresh: 42 });
    expect(ctx.settings.get("kept")).toBe("user-value");
    expect(ctx.settings.get("fresh")).toBe(42);

    ctx.settings.set("fresh", 43);
    expect(fixture.stored.addons.settings["sample"].fresh).toBe(43);
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
      [7, 5]
    ]);
  });

  it("registers page scripts under the addon namespace", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);
    ctx.ytmview.registerScript("enable", "() => {}");
    expect(fixture.registeredScripts["addon:sample"]["enable"]).toBe("() => {}");
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
    handler({ sender: {} });
    expect(listener).not.toHaveBeenCalled();

    fixture.setAppSender(true);
    handler({ sender: {} });
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
    expect(descriptor.state).toBe("active");
    expect(descriptor.lastError).toContain("listener blew up");
    expect(descriptor.lastError).toContain("settings.onDidChange");
  });

  it("contains a throwing player listener", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    ctx.player.onStateChanged(() => {
      throw new Error("state handler down");
    });

    const registered = (fixture.services.player.addEventListener as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(() => registered({})).not.toThrow();
    expect(manager.descriptors()[0].lastError).toContain("state handler down");
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
    expect(() => onListener({ sender: {} })).not.toThrow();
    expect(manager.descriptors()[0].lastError).toContain("on failed");

    const handleListener = fixture.ipcHandlers.get("addon:sample:ask");
    expect(() => handleListener({ sender: {} })).toThrow("handle failed");
    expect(manager.descriptors()[0].lastError).toContain("handle failed");
  });

  it("records a throwing badge click", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    ctx.titlebar.onBadgeClick(() => {
      throw new Error("badge boom");
    });

    expect(manager.handleBadgeClick("sample")).toBe(true);
    expect(manager.descriptors()[0].lastError).toContain("badge boom");
  });

  it("routes named playback methods through the command channel and serves queue reads", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);
    const send = fixture.services.playback.sendPlaybackCommand as ReturnType<typeof vi.fn>;

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

    const contents = fixture.windows[0].webContents;
    expect(manager.ownsWebContents(contents)).toBe(true);

    handle.close();
    expect(manager.ownsWebContents(contents)).toBe(false);
  });

  it("drops removed stylesheets instead of re-injecting them on view load", async () => {
    const fixture = fakeServices();
    const inserted: string[] = [];
    fixture.services.getYtmView = () => ({
      webContents: {
        insertCSS: async (css: string) => {
          inserted.push(css);
          return `key-${inserted.length}`;
        },
        removeInsertedCSS: async () => {},
        send: () => {}
      } as never
    });
    const { manager, ctx } = await bootWithContext(fixture);

    const keep = ctx.ytmview.insertCSS("body { opacity: 1 }");
    const drop = ctx.ytmview.insertCSS("body { opacity: 0 }");
    await new Promise(resolve => setImmediate(resolve));
    await drop.remove();
    void keep;

    inserted.length = 0;
    manager.notifyYtmViewLoaded();
    await new Promise(resolve => setImmediate(resolve));

    expect(inserted).toEqual(["body { opacity: 1 }"]);
  });

  it("keeps per-addon memory namespaced", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootWithContext(fixture);
    ctx.memory.set("status", "hosting");
    expect(ctx.memory.get("status")).toBe("hosting");
    expect((fixture.memory.get("addonMemory") as Record<string, unknown>)["sample"]).toEqual({ status: "hosting" });
  });
});

describe("validateManifest", () => {
  it("accepts a minimal valid manifest", () => {
    expect(validateManifest(manifest())).toBeNull();
  });

  it.each([
    ["bad id", manifest({ id: "Bad_ID" })],
    ["missing name", { ...manifest(), name: "" }],
    ["escaping style path", manifest({ styles: ["../outside.css"] })],
    ["absolute main", manifest({ main: "C:/evil.js" })],
    ["non-array scripts", { ...manifest(), ytmScripts: "index.js" }],
    ["not an object", "nope"]
  ])("rejects %s", (_label, value) => {
    expect(validateManifest(value)).not.toBeNull();
  });
});

describe("versionAtLeast", () => {
  it("compares numeric dot parts and ignores prerelease tags", () => {
    expect(versionAtLeast("2026.811.0", "2026.803.0")).toBe(true);
    expect(versionAtLeast("2026.803.0", "2026.811.0")).toBe(false);
    expect(versionAtLeast("2026.811.0-beta", "2026.811.0")).toBe(true);
    expect(versionAtLeast("2026.811.0", "2026.811.0")).toBe(true);
  });
});
