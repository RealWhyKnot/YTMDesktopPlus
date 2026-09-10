import { describe, expect, it, vi } from "vitest";
import { createAddonContext, type AddonHostBridge } from "../src/main/addons/context";
import { makeManifest as manifest } from "./helpers/fake-addon-context";
import { fakeServices } from "./helpers/fake-services";

function bridge(cleanups: (() => void)[], errors: string[]): AddonHostBridge {
  return {
    setSettingsSections: () => {},
    addLoadedCallback: () => () => {},
    addCssHandle: () => {},
    addCleanup: cleanup => cleanups.push(cleanup),
    setTitlebarBadge: () => {},
    addBadgeClickCallback: () => () => {},
    addActionCallback: () => () => {},
    addMessageCallback: () => () => {},
    setTrayMenuItems: () => {},
    addWindow: () => {},
    reportError: (scope: string) => errors.push(scope)
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

    ctx.theme.onChanged(() => {});

    expect(services.theme.subscribe).toHaveBeenCalled();
    expect(cleanups.length).toBe(before + 1);
  });

  it("contains a throwing callback instead of taking the addon down", () => {
    const { ctx, services, errors } = context();
    let deliver: ((theme: { id: string | null; name: string; tokens: Record<string, string> }) => void) | null = null;
    services.theme.subscribe = vi.fn(listener => {
      deliver = listener;
      return () => {};
    });

    ctx.theme.onChanged(() => {
      throw new Error("boom");
    });
    expect(deliver).not.toBeNull();
    deliver!({ id: "ember", name: "Ember", tokens: {} });

    expect(errors).toContain("theme.onChanged");
  });
});
