import Conf from "conf";
import { describe, expect, it, vi } from "vitest";
import { createAuthToken, isAuthValid } from "../src/main/integrations/companion-server/api-shared/auth";
import type { StoreSchema } from "../src/shared/store/schema";
import { makeTempDir } from "./helpers/temp-dir";

const safeStorage = vi.hoisted(() => ({
  encryptString: vi.fn((value: string) => Buffer.from(value)),
  decryptString: vi.fn((value: Buffer) => value.toString())
}));

vi.mock("electron", () => ({ safeStorage }));

function makeStore(integrations: Record<string, unknown> = { companionServerAuthTokens: null }) {
  return new Conf({
    cwd: makeTempDir("ytmd-auth-"),
    configName: "config",
    defaults: { integrations },
    projectVersion: "1.0.0"
  }) as unknown as Conf<StoreSchema>;
}

describe("companion auth tokens", () => {
  it("decrypts the stored list once across repeated requests", () => {
    const store = makeStore();
    const token = createAuthToken(store, "app", "1.0.0", "App");
    safeStorage.decryptString.mockClear();

    for (let i = 0; i < 5; i++) expect(isAuthValid(store, token)[0]).toBe(true);

    expect(safeStorage.decryptString).toHaveBeenCalledOnce();
  });

  it("stops accepting a token once the stored list no longer has it", () => {
    const store = makeStore();
    const token = createAuthToken(store, "app", "1.0.0", "App");
    expect(isAuthValid(store, token)[0]).toBe(true);

    store.set("integrations.companionServerAuthTokens", Buffer.from("[]").toString("hex"));

    expect(isAuthValid(store, token)).toEqual([false, null]);
  });

  it("replaces an app's earlier token and leaves the cached list alone when saving fails", () => {
    const store = makeStore();
    const first = createAuthToken(store, "app", "1.0.0", "App");
    expect(isAuthValid(store, first)[0]).toBe(true);
    safeStorage.encryptString.mockImplementationOnce(() => {
      throw new Error("locked");
    });

    expect(() => createAuthToken(store, "app", "1.0.1", "App")).toThrow("locked");
    expect(isAuthValid(store, first)[0]).toBe(true);

    const second = createAuthToken(store, "app", "1.0.1", "App");
    expect(isAuthValid(store, first)[0]).toBe(false);
    expect(isAuthValid(store, second)[0]).toBe(true);
  });

  it("treats a missing token list as no tokens before anything is cached", async () => {
    vi.resetModules();
    const auth = await import("../src/main/integrations/companion-server/api-shared/auth.js");

    expect(auth.isAuthValid(makeStore({}), "token")).toEqual([false, null]);
  });
});
