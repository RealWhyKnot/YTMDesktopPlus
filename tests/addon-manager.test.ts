import { readMemory } from "./helpers/read-memory";
import { requireRecord, requireValue } from "./helpers/require-value";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { scanExternalAddons } from "../src/main/addons/external-loader";
import { AddonManager } from "../src/main/addons/manager";
import type { BundledAddonDefinition } from "../src/main/addons/managed-addon";
import { manifestWarnings, SUPPORTED_ADDON_API_VERSION, validateManifest, versionAtLeast } from "../src/main/addons/validate-manifest";
import { createAddonContext, type AddonHostBridge } from "../src/main/addons/context";
import { makeManifest as manifest } from "./helpers/fake-addon-context";
import { fakeServices, fakeAddonEvent } from "./helpers/fake-services";
import { makeTempDir } from "./helpers/temp-dir";
import { bootWithContext } from "./helpers/boot-addon-context";

function nullBridge(): AddonHostBridge {
  return {
    setSettingsSections: () => {
      return undefined;
    },
    addLoadedCallback: () => () => {
      return undefined;
    },
    addCssHandle: () => {
      return undefined;
    },
    addCleanup: () => {
      return undefined;
    },
    setTitlebarBadge: () => {
      return undefined;
    },
    addBadgeClickCallback: () => () => {
      return undefined;
    },
    addActionCallback: () => () => {
      return undefined;
    },
    addMessageCallback: () => () => {
      return undefined;
    },
    setTrayMenuItems: () => {
      return undefined;
    },
    addWindow: () => {
      return undefined;
    },
    reportError: () => {
      return undefined;
    },
  };
}

describe("AddonManager", () => {
  it("activates bundled addons that default to enabled and skips the rest", async () => {
    const { services, memory } = fakeServices();
    const onActive = vi.fn();
    const offActive = vi.fn();
    const manager = new AddonManager(services);
    manager.registerBundled([
      { manifest: manifest({ id: "on-addon", defaultEnabled: true }), activate: onActive },
      { manifest: manifest({ id: "off-addon" }), activate: offActive },
    ]);
    await manager.boot();

    expect(onActive).toHaveBeenCalledOnce();
    expect(offActive).not.toHaveBeenCalled();
    const runtime = readMemory(memory, "addonsRuntime");
    expect(requireValue(runtime.find((d) => d.manifest.id === "on-addon")).state).toBe("active");
    expect(requireValue(runtime.find((d) => d.manifest.id === "off-addon")).state).toBe("disabled");
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
        },
      },
      { manifest: manifest({ id: "healthy", defaultEnabled: true }), activate: survivor },
    ]);
    await manager.boot();

    expect(survivor).toHaveBeenCalledOnce();
    const runtime = readMemory(memory, "addonsRuntime");
    expect(requireValue(runtime.find((d) => d.manifest.id === "broken")).state).toBe("error");
    expect(requireValue(runtime.find((d) => d.manifest.id === "broken")).error).toContain("boom");
    expect(requireValue(runtime.find((d) => d.manifest.id === "healthy")).state).toBe("active");
  });

  it("never loads an addon that needs a newer app", async () => {
    const { services } = fakeServices({}, "2026.803.0");
    const activate = vi.fn();
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "future", defaultEnabled: true, minAppVersion: "2026.900.0" }), activate }]);
    await manager.boot();

    expect(activate).not.toHaveBeenCalled();
    expect(requireValue(manager.descriptors()[0]).state).toBe("incompatible");
  });

  it("never loads an addon targeting a newer api generation", async () => {
    const { services } = fakeServices();
    const activate = vi.fn();
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "tomorrow", defaultEnabled: true, apiVersion: SUPPORTED_ADDON_API_VERSION + 1 }), activate }]);
    await manager.boot();

    expect(activate).not.toHaveBeenCalled();
    const descriptor = manager.descriptors()[0];
    expect(requireValue(descriptor).state).toBe("incompatible");
    expect(requireValue(descriptor).error).toContain("addon API");
  });

  it("rejects duplicate ids at registration", () => {
    const { services } = fakeServices();
    const manager = new AddonManager(services);
    manager.registerBundled([
      {
        manifest: manifest({ id: "dup" }),
        activate: () => {
          return undefined;
        },
      },
    ]);
    expect(() =>
      manager.registerBundled([
        {
          manifest: manifest({ id: "dup" }),
          activate: () => {
            return undefined;
          },
        },
      ])
    ).toThrow(/Duplicate/);
  });

  it("persists intent on setEnabled and flags the restart", async () => {
    const { services, stored } = fakeServices();
    const manager = new AddonManager(services);
    manager.registerBundled([
      {
        manifest: manifest({ id: "sample", defaultEnabled: true }),
        activate: () => {
          return undefined;
        },
      },
    ] as BundledAddonDefinition[]);
    await manager.boot();

    manager.setEnabled("sample", false);
    expect(requireValue(stored.addons.states.sample).enabled).toBe(false);
    const descriptor = manager.descriptors()[0];
    expect(requireValue(descriptor).enabled).toBe(false);
    expect(requireValue(descriptor).state).toBe("active");
    expect(requireValue(descriptor).restartRequired).toBe(true);

    manager.setEnabled("sample", true);
    expect(requireValue(manager.descriptors()[0]).restartRequired).toBe(false);
  });

  it("asks for acknowledgement only for external addons that lack it", async () => {
    const { services } = fakeServices();
    const manager = new AddonManager(services);
    manager.registerBundled([
      {
        manifest: manifest({ id: "built-in", defaultEnabled: true }),
        activate: () => {
          return undefined;
        },
      },
    ]);
    manager.registerExternal([
      { dir: "x", folderName: "outside", manifest: manifest({ id: "outside" }) },
      { dir: "y", folderName: "trusted", manifest: manifest({ id: "trusted" }) },
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
    const destruction = Promise.withResolvers<undefined>();
    let isSettled = false;
    const destroy = vi.fn(async () => {
      await destruction.promise;
      isSettled = true;
    });
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "sample", defaultEnabled: true }), activate: () => ({ destroy }) }]);
    await manager.boot();

    const shutdown = manager.shutdown();
    expect(isSettled).toBe(false);
    destruction.resolve(undefined);
    await shutdown;
    expect(isSettled).toBe(true);

    await manager.shutdown();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

describe("dev reload", () => {
  const addonSource = (version: string) => `
let activations = 0;
module.exports.activate = ctx => {
  activations++;
  ctx.memory.set("version", "${version}");
  ctx.memory.set("activations", activations);
  ctx.titlebar.setBadge({ icon: "check" });
  return { destroy() { ctx.memory.set("sawDestroy", "${version}"); } };
};`;

  function externalAddonOnDisk() {
    const root = makeTempDir("ytmd-reload-test-");
    const dir = path.join(root, "reloadable");
    fs.mkdirSync(dir);
    fs.writeFileSync(
      path.join(dir, "manifest.json"),
      JSON.stringify({ id: "reloadable", name: "Reloadable", version: "1.0.0", author: "someone", description: "reload target", main: "index.js" })
    );
    fs.writeFileSync(path.join(dir, "index.js"), addonSource("one"));
    return { root, dir };
  }

  it("surfaces manifest warnings on the descriptor and clears them after a fixed reload", async () => {
    const { root, dir } = externalAddonOnDisk();
    const clean = requireRecord(JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")));
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ ...clean, version: "not-semver" }));
    const fixture = fakeServices({ reloadable: { enabled: true } });
    const manager = new AddonManager(fixture.services);
    manager.registerExternal(scanExternalAddons(root));
    await manager.boot();

    expect(requireValue(manager.descriptors()[0]).warnings?.join(" ")).toContain("semver");

    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(clean));
    await manager.reloadExternal("reloadable");
    expect(requireValue(manager.descriptors()[0]).warnings).toEqual([]);
  });

  it("tears down, busts the module cache and activates fresh sources", async () => {
    const { root, dir } = externalAddonOnDisk();
    const fixture = fakeServices({ reloadable: { enabled: true } });
    const manager = new AddonManager(fixture.services);
    manager.registerExternal(scanExternalAddons(root));
    await manager.boot();

    const bag = () => readMemory(fixture.memory, "addonMemory").reloadable;
    expect(requireValue(manager.descriptors()[0]).state).toBe("active");
    expect(bag()).toMatchObject({ version: "one", activations: 1 });
    expect(fixture.memory.get("addonTitlebarBadges")).toHaveLength(1);

    fs.writeFileSync(path.join(dir, "index.js"), addonSource("two"));
    await manager.reloadExternal("reloadable");

    expect(bag()).toMatchObject({ version: "two", activations: 1, sawDestroy: "one" });
    expect(requireValue(manager.descriptors()[0]).state).toBe("active");
    expect(fixture.memory.get("addonTitlebarBadges")).toHaveLength(1);
  });

  it("reload surfaces a broken edit as an error and recovers on the next one", async () => {
    const { root, dir } = externalAddonOnDisk();
    const fixture = fakeServices({ reloadable: { enabled: true } });
    const manager = new AddonManager(fixture.services);
    manager.registerExternal(scanExternalAddons(root));
    await manager.boot();

    fs.writeFileSync(path.join(dir, "index.js"), "module.exports = { broken: true };");
    await manager.reloadExternal("reloadable");
    expect(requireValue(manager.descriptors()[0]).state).toBe("error");
    expect(requireValue(manager.descriptors()[0]).error).toContain("activate");

    fs.writeFileSync(path.join(dir, "index.js"), addonSource("three"));
    await manager.reloadExternal("reloadable");
    expect(requireValue(manager.descriptors()[0]).state).toBe("active");
  });

  it("ignores bundled addons", async () => {
    const fixture = fakeServices();
    const { manager } = await bootWithContext(fixture);
    await manager.reloadExternal("sample");
    expect(requireValue(manager.descriptors()[0]).state).toBe("active");
  });
});

describe("settings actions", () => {
  it("routes button clicks to the addon and contains a throwing callback", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    const clicked = vi.fn();
    ctx.settings.onAction("openPanel", clicked);
    ctx.settings.onAction("broken", () => {
      throw new Error("action boom");
    });

    expect(manager.handleSettingsAction("sample", "openPanel")).toBe(true);
    expect(clicked).toHaveBeenCalledOnce();

    expect(manager.handleSettingsAction("sample", "missing")).toBe(false);
    expect(manager.handleSettingsAction("other", "openPanel")).toBe(false);

    expect(() => manager.handleSettingsAction("sample", "broken")).not.toThrow();
    expect(requireValue(manager.descriptors()[0]).lastError).toContain("action boom");
  });

  it("stops firing after unsubscribe", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    const clicked = vi.fn();
    const unsubscribe = ctx.settings.onAction("openPanel", clicked);

    unsubscribe();
    expect(manager.handleSettingsAction("sample", "openPanel")).toBe(false);
    expect(clicked).not.toHaveBeenCalled();
  });
});

describe("tray items", () => {
  it("stores, replaces and clears per-addon items and rebuilds the menu", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);

    ctx.tray.setMenuItems([
      {
        label: "Open",
        click: () => {
          return undefined;
        },
      },
    ]);
    expect(manager.trayMenuItems().map((item) => item.label)).toEqual(["Open"]);

    ctx.tray.setMenuItems([
      {
        label: "First",
        click: () => {
          return undefined;
        },
      },
      {
        label: "Second",
        enabled: false,
        click: () => {
          return undefined;
        },
      },
    ]);
    const items = manager.trayMenuItems();
    expect(items.map((item) => [item.label, item.enabled])).toEqual([
      ["First", true],
      ["Second", false],
    ]);

    ctx.tray.setMenuItems([]);
    expect(manager.trayMenuItems()).toEqual([]);
    expect(fixture.services.refreshTrayMenu).toHaveBeenCalledTimes(3);
  });

  it("contains a throwing click and records it", async () => {
    const fixture = fakeServices();
    const { manager, ctx } = await bootWithContext(fixture);
    ctx.tray.setMenuItems([
      {
        label: "Broken",
        click: () => {
          throw new Error("tray boom");
        },
      },
    ]);

    expect(() => requireValue(manager.trayMenuItems()[0]).click()).not.toThrow();
    expect(requireValue(manager.descriptors()[0]).lastError).toContain("tray boom");
  });
});

describe("addon windows", () => {
  it("validates the options and resolves file windows inside the addon folder", () => {
    const fixture = fakeServices();
    const dir = path.join(fixture.services.userDataPath, "addons", "sample");
    const ctx = createAddonContext(manifest(), fixture.services, nullBridge(), dir);

    expect(() => ctx.windows.create({ width: 1, height: 1 })).toThrow(/exactly one/);
    expect(() => ctx.windows.create({ entry: "room", file: "a.html", width: 1, height: 1 })).toThrow(/exactly one/);
    expect(() => ctx.windows.create({ file: "../escape.html", width: 1, height: 1 })).toThrow(/inside the addon folder/);
    expect(() => ctx.windows.create({ file: path.resolve("/outside.html"), width: 1, height: 1 })).toThrow(/inside the addon folder/);

    ctx.windows.create({ file: "panel.html", width: 320, height: 200 });
    const options = requireValue(vi.mocked(fixture.services.createWindow).mock.calls[0])[0];
    expect(options.filePath).toBe(path.join(dir, "panel.html"));
    expect(options.addonId).toBe("sample");

    const closeListener = fixture.ipcListeners.get("addon:sample:window:close");
    expect(closeListener).toBeDefined();
    requireValue(closeListener)(fakeAddonEvent());
    expect(requireValue(fixture.windows[0]).close).not.toHaveBeenCalled();
    requireValue(closeListener)(fakeAddonEvent(requireValue(fixture.windows[0]).webContents));
    expect(requireValue(fixture.windows[0]).close).toHaveBeenCalledOnce();
  });

  it("refuses file windows without an addon folder and namespaces handle sends", () => {
    const fixture = fakeServices();
    const ctx = createAddonContext(manifest(), fixture.services, nullBridge());

    expect(() => ctx.windows.create({ file: "panel.html", width: 1, height: 1 })).toThrow(/bundled addons use entry/);

    const handle = ctx.windows.create({ entry: "room", width: 1, height: 1 });
    handle.send("hello", 1);
    expect(requireValue(fixture.windows[0]).webContents.send).toHaveBeenCalledWith("addon:sample:hello", 1);
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
    ["non-string homepage", { ...manifest(), homepage: 42 }],
    ["fractional apiVersion", { ...manifest(), apiVersion: 1.5 }],
    ["not an object", "nope"],
  ])("rejects %s", (_label, value) => {
    expect(validateManifest(value)).not.toBeNull();
  });

  it("accepts homepage and apiVersion when well formed", () => {
    expect(validateManifest(manifest({ homepage: "https://example.invalid", apiVersion: 1 }))).toBeNull();
  });
});

describe("manifestWarnings", () => {
  it("warns on loose versions and non-http homepages without failing the addon", () => {
    expect(manifestWarnings(manifest())).toEqual([]);
    expect(manifestWarnings(manifest({ version: "v2" }))).toHaveLength(1);
    expect(manifestWarnings(manifest({ minAppVersion: "latest" }))).toHaveLength(1);
    expect(manifestWarnings(manifest({ homepage: "ftp://example.invalid" }))).toHaveLength(1);
    expect(manifestWarnings(manifest({ homepage: "https://example.invalid" }))).toEqual([]);
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
