import log from "electron-log";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableIntegrationsAtBoot, syncIntegrations, type IntegrationRegistration } from "../src/main/integrations/lifecycle";
import { isStoreSchema } from "../src/shared/store/validate-settings";
import { settingsState } from "./components/fixtures";

function state(flags: Record<string, boolean>) {
  const value = settingsState({
    metadata: { version: 1 },
    integrations: { listenAlongEnabled: false, listenAlongHost: null, listenAlongHostPort: 9863, listenAlongToken: null },
    state: { lastUrl: "", lastPlaylistId: null, lastVideoId: "", windowBounds: null, windowMaximized: false },
    lastfm: { api_key: "key", secret: "secret", token: null },
    updates: { firstRunPromptShown: false },
    addons: { states: {}, settings: { fixture: flags } },
    themes: { active: null },
  });
  if (!isStoreSchema(value)) throw new TypeError("Expected a complete settings fixture");
  return value;
}

const makeRegistration = (label: string, flag: string, calls: string[]): IntegrationRegistration => ({
  label,
  isEnabled: (current) => {
    const value = current.addons.settings.fixture?.[flag];
    if (typeof value !== "boolean") throw new TypeError("Expected an integration flag");
    return value;
  },
  integration: {
    enable: () => {
      calls.push(`enable:${label}`);
    },
    disable: () => {
      calls.push(`disable:${label}`);
    },
  },
  provide: () => calls.push(`provide:${label}`),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("integration lifecycle", () => {
  it("provides before enabling on a rising edge and logs the label", () => {
    const calls: string[] = [];
    const info = vi.spyOn(log, "info").mockImplementation(() => {
      return undefined;
    });

    syncIntegrations([makeRegistration("Sample", "x", calls)], state({ x: true }), state({ x: false }));

    expect(calls).toEqual(["provide:Sample", "enable:Sample"]);
    expect(info).toHaveBeenCalledWith("Integration enabled: Sample");
  });

  it("disables on a falling edge without providing", () => {
    const calls: string[] = [];
    const info = vi.spyOn(log, "info").mockImplementation(() => {
      return undefined;
    });

    syncIntegrations([makeRegistration("Sample", "x", calls)], state({ x: false }), state({ x: true }));

    expect(calls).toEqual(["disable:Sample"]);
    expect(info).toHaveBeenCalledWith("Integration disabled: Sample");
  });

  it("re-provides on every change while enabled without re-enabling", () => {
    const calls: string[] = [];
    vi.spyOn(log, "info").mockImplementation(() => {
      return undefined;
    });

    syncIntegrations([makeRegistration("Sample", "x", calls)], state({ x: true }), state({ x: true }));

    expect(calls).toEqual(["provide:Sample"]);
  });

  it("does nothing while disabled", () => {
    const calls: string[] = [];

    syncIntegrations([makeRegistration("Sample", "x", calls)], state({ x: false }), state({ x: false }));

    expect(calls).toEqual([]);
  });

  it("skips the provide hook for registrations without one", () => {
    const calls: string[] = [];
    vi.spyOn(log, "info").mockImplementation(() => {
      return undefined;
    });
    const registration = makeRegistration("Sample", "x", calls);
    delete registration.provide;

    syncIntegrations([registration], state({ x: true }), state({ x: false }));

    expect(calls).toEqual(["enable:Sample"]);
  });

  it("boot-enables only enabled registrations, in order", () => {
    const calls: string[] = [];
    const info = vi.spyOn(log, "info").mockImplementation(() => {
      return undefined;
    });
    const registrations = [makeRegistration("A", "a", calls), makeRegistration("B", "b", calls), makeRegistration("C", "c", calls)];

    enableIntegrationsAtBoot(registrations, state({ a: true, b: false, c: true }));

    expect(calls).toEqual(["provide:A", "enable:A", "provide:C", "enable:C"]);
    expect(info).toHaveBeenCalledWith("Integration enabled: A");
    expect(info).not.toHaveBeenCalledWith("Integration enabled: B");
  });
});
