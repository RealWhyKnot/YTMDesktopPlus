import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { scanAddonFolder, scanExternalAddons } from "../src/main/addons/external-loader";
import { ADDON_ACTIVATE_TIMEOUT_MS, ADDON_FILES_CHANGED_WARNING, AddonManager } from "../src/main/addons/manager";
import { createAddonContext, type AddonContext, type AddonHostBridge } from "../src/main/addons/context";
import { MANIFEST_TEXT_LIMITS, validateManifest } from "../src/main/addons/validate-manifest";
import { validateThemeManifest } from "../src/main/themes/validate-manifest";
import type { AddonDescriptor, AddonTitlebarBadge } from "../src/shared/addons/types";
import { makeManifest as manifest } from "./helpers/fake-addon-context";
import { fakeServices } from "./helpers/fake-services";
import { makeTempDir } from "./helpers/temp-dir";

const fakeView = () => ({ webContents: { send: vi.fn() } as unknown as Electron.WebContents });

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function runtimeOf(memory: Map<string, unknown>, id: string): AddonDescriptor {
  return (memory.get("addonsRuntime") as AddonDescriptor[]).find(descriptor => descriptor.manifest.id === id);
}

async function bootOne(fixture: ReturnType<typeof fakeServices>, activate: (ctx: AddonContext) => unknown = () => {}) {
  let ctx: AddonContext;
  const manager = new AddonManager(fixture.services);
  manager.registerBundled([
    {
      manifest: manifest({ id: "sample", defaultEnabled: true }),
      activate: async context => {
        ctx = context;
        await activate(context);
      }
    }
  ]);
  await manager.boot();
  return { manager, ctx };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("activate timeout", () => {
  it("gives up on an addon that never finishes activating and boots the rest", async () => {
    vi.useFakeTimers();
    const fixture = fakeServices();
    const neighbour = vi.fn();
    const manager = new AddonManager(fixture.services);
    manager.registerBundled([
      {
        manifest: manifest({ id: "stuck", defaultEnabled: true }),
        activate: ctx => {
          ctx.titlebar.setBadge({ icon: "hourglass" });
          return new Promise(() => {});
        }
      },
      { manifest: manifest({ id: "healthy", defaultEnabled: true }), activate: neighbour }
    ]);

    const booted = manager.boot();
    await vi.advanceTimersByTimeAsync(ADDON_ACTIVATE_TIMEOUT_MS);
    await booted;

    expect(neighbour).toHaveBeenCalledOnce();
    expect(runtimeOf(fixture.memory, "stuck").state).toBe("error");
    expect(runtimeOf(fixture.memory, "stuck").error).toContain(`${ADDON_ACTIVATE_TIMEOUT_MS / 1000} seconds`);
    expect(fixture.memory.get("addonTitlebarBadges")).toEqual([]);
    expect(runtimeOf(fixture.memory, "healthy").state).toBe("active");
  });

  it("tears down an activation that finishes after the timeout", async () => {
    vi.useFakeTimers();
    const fixture = fakeServices();
    const destroy = vi.fn();
    const lateCleanup = vi.fn();
    let finish: () => void;
    let ctx: AddonContext;
    const manager = new AddonManager(fixture.services);
    manager.registerBundled([
      {
        manifest: manifest({ id: "slow", defaultEnabled: true }),
        activate: async context => {
          ctx = context;
          await new Promise<void>(resolve => {
            finish = resolve;
          });
          context.settings.onDidChange("x", lateCleanup);
          context.titlebar.setBadge({ icon: "late" });
          return { destroy };
        }
      }
    ]);

    const booted = manager.boot();
    await vi.advanceTimersByTimeAsync(ADDON_ACTIVATE_TIMEOUT_MS);
    await booted;
    finish();
    await vi.advanceTimersByTimeAsync(0);

    expect(destroy).toHaveBeenCalledOnce();
    expect(fixture.memory.get("addonTitlebarBadges")).toEqual([]);
    expect(runtimeOf(fixture.memory, "slow").state).toBe("error");
    ctx.settings.set("x", 1);
    expect(lateCleanup).not.toHaveBeenCalled();
  });

  it("runs page hooks for an addon that activates after the page loaded", async () => {
    const fixture = fakeServices();
    fixture.services.getYtmView = fakeView;
    const onLoaded = vi.fn();
    const manager = new AddonManager(fixture.services);
    manager.registerBundled([
      {
        manifest: manifest({ id: "late", defaultEnabled: true }),
        activate: ctx => {
          ctx.ytmview.onLoaded(onLoaded);
        }
      }
    ]);
    manager.notifyYtmViewLoaded();
    await manager.boot();

    expect(onLoaded).toHaveBeenCalledOnce();
  });
});

describe("page calls before the page exists", () => {
  it("rejects invokeScript and innertube.request with a clear error while there is no page", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootOne(fixture);

    await expect(ctx.ytmview.invokeScript("x")).rejects.toThrow(/ytmview\.onLoaded/);
    await expect(ctx.innertube.request("browse")).rejects.toThrow(/ytmview\.onLoaded/);
    expect(fixture.services.invokeYtmScript).not.toHaveBeenCalled();

    fixture.services.getYtmView = fakeView;
    await ctx.ytmview.invokeScript("x", 1);
    expect(fixture.services.invokeYtmScript).toHaveBeenCalledWith("addon:sample", "x", 1);
  });
});

describe("async callback failures", () => {
  it("records rejected promises from every callback the manager invokes", async () => {
    const fixture = fakeServices();
    fixture.services.getYtmView = fakeView;
    const fail = (message: string) => async () => {
      throw new Error(message);
    };
    const { manager } = await bootOne(fixture, ctx => {
      ctx.ytmview.onLoaded(fail("loaded"));
      ctx.ytmview.onMessage("ping", fail("message"));
      ctx.settings.onAction("press", fail("action"));
      ctx.titlebar.onBadgeClick(fail("badge"));
      ctx.tray.setMenuItems([{ label: "Go", click: fail("tray") }]);
    });

    const checks: [() => void, string][] = [
      [() => manager.notifyYtmViewLoaded(), "ytmview.onLoaded: loaded"],
      [() => manager.handleViewMessage("sample", "ping", null), "ytmview.onMessage(ping): message"],
      [() => manager.handleSettingsAction("sample", "press"), "settings.onAction(press): action"],
      [() => manager.handleBadgeClick("sample"), "titlebar.onBadgeClick: badge"],
      [() => manager.trayMenuItems()[0].click(), "tray.item: tray"]
    ];
    for (const [trigger, expected] of checks) {
      trigger();
      await flush();
      expect(runtimeOf(fixture.memory, "sample").lastError).toBe(expected);
    }
    expect(runtimeOf(fixture.memory, "sample").state).toBe("active");
  });
});

describe("risk acknowledgement fingerprint", () => {
  function addonOnDisk() {
    const root = makeTempDir("ytmd-fingerprint-test-");
    const dir = path.join(root, "pinned");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ id: "pinned", name: "Pinned", version: "1.0.0", author: "someone", description: "d", main: "index.js", ytmScripts: ["page.js"] })
    );
    fs.writeFileSync(path.join(dir, "index.js"), "module.exports.activate = () => {};");
    fs.writeFileSync(path.join(dir, "page.js"), "() => {}");
    return { root, dir };
  }

  it("changes when main or a page script changes", () => {
    const { dir } = addonOnDisk();
    const first = scanAddonFolder(dir).fingerprint;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    fs.writeFileSync(path.join(dir, "page.js"), "() => { steal(); }");
    const second = scanAddonFolder(dir).fingerprint;
    fs.writeFileSync(path.join(dir, "index.js"), "module.exports.activate = () => { steal(); };");
    const third = scanAddonFolder(dir).fingerprint;
    expect(new Set([first, second, third]).size).toBe(3);
  });

  it("pins the files on first trust and asks again after they change", async () => {
    const { root, dir } = addonOnDisk();
    const fixture = fakeServices({ pinned: { enabled: true, riskAcknowledged: true } as { enabled: boolean } });
    const states = () => fixture.stored.addons.states as Record<string, { enabled: boolean; riskAcknowledged?: boolean; fingerprint?: string }>;

    const first = new AddonManager(fixture.services);
    first.registerExternal(scanExternalAddons(root));
    await first.boot();
    expect(runtimeOf(fixture.memory, "pinned").state).toBe("active");
    const pinned = states().pinned.fingerprint;
    expect(pinned).toBe(scanAddonFolder(dir).fingerprint);
    expect(first.needsRiskAcknowledgement("pinned")).toBe(false);

    fs.writeFileSync(path.join(dir, "index.js"), "module.exports.activate = () => { steal(); };");
    const second = new AddonManager(fixture.services);
    second.registerExternal(scanExternalAddons(root));
    await second.boot();
    const descriptor = runtimeOf(fixture.memory, "pinned");
    expect(descriptor.state).toBe("disabled");
    expect(descriptor.enabled).toBe(false);
    expect(descriptor.warnings).toContain(ADDON_FILES_CHANGED_WARNING);
    expect(second.needsRiskAcknowledgement("pinned")).toBe(true);

    second.acknowledgeRisk("pinned");
    expect(states().pinned.fingerprint).toBe(scanAddonFolder(dir).fingerprint);
    expect(states().pinned.fingerprint).not.toBe(pinned);
    expect(second.needsRiskAcknowledgement("pinned")).toBe(false);
    expect(second.descriptors().find(entry => entry.manifest.id === "pinned").warnings).not.toContain(ADDON_FILES_CHANGED_WARNING);
  });
});

describe("stored state for uninstalled addons", () => {
  it("drops state and settings once the folder is gone and keeps it while the folder exists", async () => {
    const fixture = fakeServices({
      gone: { enabled: true },
      unreadable: { enabled: true },
      sample: { enabled: true }
    });
    fixture.stored.addons.settings = { gone: { a: 1 }, unreadable: { b: 2 }, sample: { c: 3 } };
    fs.mkdirSync(path.join(fixture.services.userDataPath, "addons", "unreadable"), { recursive: true });

    await bootOne(fixture);

    expect(Object.keys(fixture.stored.addons.states).sort()).toEqual(["sample", "unreadable"]);
    expect(Object.keys(fixture.stored.addons.settings).sort()).toEqual(["sample", "unreadable"]);
  });
});

describe("entry windows", () => {
  it("refuses entry windows from an external addon", () => {
    const fixture = fakeServices();
    const dir = path.join(fixture.services.userDataPath, "addons", "sample");
    const ctx = createAddonContext(manifest(), fixture.services, nullBridge(), dir);
    expect(() => ctx.windows.create({ entry: "room", width: 1, height: 1 })).toThrow(/only bundled addons/);
    expect(fixture.services.createWindow).not.toHaveBeenCalled();
  });
});

describe("manifest text limits", () => {
  const theme = (overrides: Record<string, unknown> = {}) => ({ id: "sample", name: "S", version: "1.0.0", author: "a", description: "d", ...overrides });

  it.each(Object.entries(MANIFEST_TEXT_LIMITS))("caps %s at %i characters for addons and themes", (field, limit) => {
    const atLimit = field === "homepage" ? `https://e.invalid/${"a".repeat(limit - 18)}` : "1".repeat(limit);
    const overLimit = `${atLimit}a`;
    expect(validateManifest({ ...manifest(), [field]: atLimit })).toBeNull();
    expect(validateManifest({ ...manifest(), [field]: overLimit })).toBe(`${field} is longer than ${limit} characters`);
    expect(validateThemeManifest(theme({ [field]: atLimit }))).toBeNull();
    expect(validateThemeManifest(theme({ [field]: overLimit }))).toBe(`${field} is longer than ${limit} characters`);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(validateManifest({ ...manifest(), name: "🎵".repeat(MANIFEST_TEXT_LIMITS.name) })).toBeNull();
  });
});

describe("titlebar badge", () => {
  it("clamps long badge text and tooltips", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootOne(fixture);
    ctx.titlebar.setBadge({ icon: "x".repeat(500), text: "🎵".repeat(40), tooltip: "t".repeat(1000), active: "yes" as unknown as boolean });

    const [badge] = fixture.memory.get("addonTitlebarBadges") as AddonTitlebarBadge[];
    expect(Array.from(badge.text)).toHaveLength(12);
    expect(badge.text.endsWith("…")).toBe(true);
    expect(Array.from(badge.tooltip)).toHaveLength(200);
    expect(badge.icon.length).toBeLessThanOrEqual(64);
    expect(badge.active).toBe(false);
  });

  it("leaves short badges alone", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootOne(fixture);
    ctx.titlebar.setBadge({ icon: "headphones", text: "3 live", tooltip: "Room", active: true });
    expect(fixture.memory.get("addonTitlebarBadges")).toEqual([{ addonId: "sample", icon: "headphones", text: "3 live", tooltip: "Room", active: true }]);
  });
});

describe("number settings", () => {
  const sections = [{ fields: [{ key: "level", type: "number" as const, label: "Level", min: 0, max: 10 }] }];

  it("clamps writes from the addon and rejects NaN", async () => {
    const fixture = fakeServices();
    const { ctx } = await bootOne(fixture, context => {
      context.settings.registerDefaults({ level: 5 });
      context.settings.registerSettingsUI(sections);
    });

    ctx.settings.set("level", 50);
    expect(ctx.settings.get("level")).toBe(10);
    ctx.settings.set("level", -3);
    expect(ctx.settings.get("level")).toBe(0);
    expect(() => ctx.settings.set("level", Number.NaN)).toThrow(TypeError);
    expect(() => ctx.settings.set("level", Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(ctx.settings.get("level")).toBe(0);
  });

  it("repairs a bad stored value when the settings UI registers", async () => {
    const fixture = fakeServices();
    fixture.stored.addons.settings = { sample: { level: null } };
    const { ctx } = await bootOne(fixture, context => {
      context.settings.registerDefaults({ level: 5 });
      context.settings.registerSettingsUI(sections);
    });
    expect(ctx.settings.get("level")).toBe(5);
  });

  it("corrects out of range and NaN writes from elsewhere before the addon sees them", async () => {
    const fixture = fakeServices();
    const seen = vi.fn();
    const { ctx } = await bootOne(fixture, context => {
      context.settings.registerDefaults({ level: 5 });
      context.settings.onDidChange("level", seen);
      context.settings.registerSettingsUI(sections);
    });
    const writeFromSettingsWindow = (value: unknown) => {
      const addons = fixture.services.store.get("addons");
      addons.settings.sample.level = value;
      fixture.services.store.set("addons", addons);
    };

    writeFromSettingsWindow(7);
    writeFromSettingsWindow(Number.NaN);
    expect(ctx.settings.get("level")).toBe(7);
    writeFromSettingsWindow(null);
    expect(ctx.settings.get("level")).toBe(7);
    writeFromSettingsWindow(99);
    expect(ctx.settings.get("level")).toBe(10);

    for (const [next] of seen.mock.calls) {
      expect(Number.isFinite(next)).toBe(true);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(10);
    }
    expect(seen.mock.calls.map(([next]) => next)).toEqual([7, 10]);
  });
});

function nullBridge(): AddonHostBridge {
  return {
    setSettingsSections: () => {},
    addLoadedCallback: () => () => {},
    addCssHandle: () => {},
    addCleanup: () => {},
    setTitlebarBadge: () => {},
    addBadgeClickCallback: () => () => {},
    addActionCallback: () => () => {},
    addMessageCallback: () => () => {},
    setTrayMenuItems: () => {},
    addWindow: () => {},
    reportError: () => {}
  };
}
