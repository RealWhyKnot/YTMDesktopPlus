import { describe, expect, it, vi } from "vitest";
import { requireValue } from "./helpers/require-value";
import { createAddonContext, type AddonHostBridge } from "../src/main/addons/context";
import { makeManifest as manifest } from "./helpers/fake-addon-context";
import { fakeServices } from "./helpers/fake-services";

function bridge(cleanups: (() => void)[], errors: string[]): AddonHostBridge {
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
    addCleanup: (cleanup) => cleanups.push(cleanup),
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
    reportError: (scope: string) => errors.push(scope),
  };
}

function context() {
  const { services } = fakeServices();
  const cleanups: (() => void)[] = [];
  const errors: string[] = [];
  const ctx = createAddonContext(manifest({ id: "themed" }), services, bridge(cleanups, errors));
  return { ctx, services, cleanups, errors };
}

describe("ctx.theme", () => {
  it("hands the addon the active theme from the host", () => {
    const { ctx, services } = context();
    services.theme.get = vi.fn(() => ({ id: "drift", name: "Drift", tokens: { "--accent": "#7fb3d5" } }));

    expect(ctx.theme.get()).toEqual({ id: "drift", name: "Drift", tokens: { "--accent": "#7fb3d5" } });
  });

  it("subscribes through the host and registers a cleanup", () => {
    const { ctx, services, cleanups } = context();
    const before = cleanups.length;

    ctx.theme.onChanged(() => {
      return undefined;
    });

    expect(services.theme.subscribe).toHaveBeenCalled();
    expect(cleanups.length).toBe(before + 1);
  });

  it("contains a throwing callback instead of taking the addon down", () => {
    const { ctx, services, errors } = context();
    const deliveries: ((theme: { id: string | null; name: string; tokens: Record<string, string> }) => void)[] = [];
    services.theme.subscribe = vi.fn((listener) => {
      deliveries.push(listener);
      return () => {
        return undefined;
      };
    });

    ctx.theme.onChanged(() => {
      throw new Error("boom");
    });
    expect(deliveries).toHaveLength(1);
    requireValue(deliveries[0])({ id: "ember", name: "Ember", tokens: {} });

    expect(errors).toContain("theme.onChanged");
  });
});
