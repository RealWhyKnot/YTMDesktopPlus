import { describe, expect, it, vi } from "vitest";
import { AddonManager, BundledAddonDefinition } from "../src/main/addons/manager";
import { validateManifest, versionAtLeast } from "../src/main/addons/validate-manifest";
import type { AddonManifest } from "../src/shared/addons/types";

function manifest(overrides: Partial<AddonManifest> = {}): AddonManifest {
  return {
    id: "sample",
    name: "Sample",
    version: "1.0.0",
    author: "someone",
    description: "a sample addon",
    ...overrides
  };
}

function fakeServices(persistedStates: Record<string, { enabled: boolean }> = {}, appVersion = "2026.811.0") {
  const stored = { addons: { states: persistedStates, settings: {} } as { states: Record<string, { enabled: boolean }>; settings: Record<string, unknown> } };
  const memory = new Map<string, unknown>();
  return {
    services: {
      store: {
        get: (key: string) => stored[key as keyof typeof stored],
        set: (key: string, value: unknown) => {
          stored[key as keyof typeof stored] = value as never;
        }
      },
      memoryStore: {
        set: (key: string, value: unknown) => memory.set(key, value)
      },
      appVersion
    } as never,
    stored,
    memory
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

  it("shuts instances down on quit", async () => {
    const { services } = fakeServices();
    const destroy = vi.fn();
    const manager = new AddonManager(services);
    manager.registerBundled([{ manifest: manifest({ id: "sample", defaultEnabled: true }), activate: () => ({ destroy }) }]);
    await manager.boot();
    await manager.shutdown();
    expect(destroy).toHaveBeenCalledOnce();
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
