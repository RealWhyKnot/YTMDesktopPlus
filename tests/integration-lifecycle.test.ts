import log from "electron-log";
import { afterEach, describe, expect, it, vi } from "vitest";
import { enableIntegrationsAtBoot, syncIntegrations, type IntegrationRegistration } from "../src/main/integrations/lifecycle";
import type { StoreSchema } from "../src/shared/store/schema";

type FlagState = { flags: Record<string, boolean> };

const state = (flags: Record<string, boolean>) => ({ flags }) as unknown as StoreSchema;

const makeRegistration = (label: string, flag: string, calls: string[]): IntegrationRegistration => ({
  label,
  isEnabled: current => (current as unknown as FlagState).flags[flag],
  integration: {
    enable: () => calls.push(`enable:${label}`),
    disable: () => calls.push(`disable:${label}`)
  },
  provide: () => calls.push(`provide:${label}`)
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("integration lifecycle", () => {
  it("provides before enabling on a rising edge and logs the label", () => {
    const calls: string[] = [];
    const info = vi.spyOn(log, "info").mockImplementation(() => {});

    syncIntegrations([makeRegistration("Sample", "x", calls)], state({ x: true }), state({ x: false }));

    expect(calls).toEqual(["provide:Sample", "enable:Sample"]);
    expect(info).toHaveBeenCalledWith("Integration enabled: Sample");
  });

  it("disables on a falling edge without providing", () => {
    const calls: string[] = [];
    const info = vi.spyOn(log, "info").mockImplementation(() => {});

    syncIntegrations([makeRegistration("Sample", "x", calls)], state({ x: false }), state({ x: true }));

    expect(calls).toEqual(["disable:Sample"]);
    expect(info).toHaveBeenCalledWith("Integration disabled: Sample");
  });

  it("re-provides on every change while enabled without re-enabling", () => {
    const calls: string[] = [];
    vi.spyOn(log, "info").mockImplementation(() => {});

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
    vi.spyOn(log, "info").mockImplementation(() => {});
    const registration = makeRegistration("Sample", "x", calls);
    delete registration.provide;

    syncIntegrations([registration], state({ x: true }), state({ x: false }));

    expect(calls).toEqual(["enable:Sample"]);
  });

  it("boot-enables only enabled registrations, in order", () => {
    const calls: string[] = [];
    const info = vi.spyOn(log, "info").mockImplementation(() => {});
    const registrations = [makeRegistration("A", "a", calls), makeRegistration("B", "b", calls), makeRegistration("C", "c", calls)];

    enableIntegrationsAtBoot(registrations, state({ a: true, b: false, c: true }));

    expect(calls).toEqual(["provide:A", "enable:A", "provide:C", "enable:C"]);
    expect(info).toHaveBeenCalledWith("Integration enabled: A");
    expect(info).not.toHaveBeenCalledWith("Integration enabled: B");
  });
});
