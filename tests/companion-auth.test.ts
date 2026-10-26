import crypto from "crypto";
import Conf from "conf";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FAILED_AUTH_LIMIT,
  FAILED_AUTH_LOCKOUT_MS,
  LAST_USED_RESOLUTION_MS,
  clearFailedAuth,
  createAuthToken,
  getAuthTokens,
  getTemporaryAuthCode,
  isAuthLockedOut,
  isAuthValid,
  recordFailedAuth
} from "../src/main/integrations/companion-server/api-shared/auth";
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

describe("companion pairing codes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("draws every digit from 0 to 9", async () => {
    const randomInt = vi.spyOn(crypto, "randomInt");

    const code = await getTemporaryAuthCode("digits", "1.0.0", "Digits");

    expect(code).toMatch(/^[0-9]{4}$/);
    expect(randomInt.mock.calls.length).toBeGreaterThan(0);
    for (const call of randomInt.mock.calls) expect(call).toEqual([0, 10]);
  });
});

describe("companion token last used", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stamps a new token and refreshes the stamp at most once per resolution window", () => {
    vi.useFakeTimers({ now: 1_000_000 });
    const store = makeStore();
    const token = createAuthToken(store, "app", "1.0.0", "App");
    expect(getAuthTokens(store)[0].lastUsed).toBe(1_000_000);

    vi.setSystemTime(1_000_000 + LAST_USED_RESOLUTION_MS - 1);
    safeStorage.encryptString.mockClear();
    isAuthValid(store, token);
    expect(safeStorage.encryptString).not.toHaveBeenCalled();

    vi.setSystemTime(1_000_000 + LAST_USED_RESOLUTION_MS);
    expect(isAuthValid(store, token)[0]).toBe(true);
    expect(getAuthTokens(store)[0].lastUsed).toBe(1_000_000 + LAST_USED_RESOLUTION_MS);
    expect(JSON.parse(Buffer.from(store.get("integrations.companionServerAuthTokens"), "hex").toString())[0].lastUsed).toBe(
      1_000_000 + LAST_USED_RESOLUTION_MS
    );
  });

  it("adds the stamp to a token stored before it existed and keeps the other fields", () => {
    vi.useFakeTimers({ now: 5_000 });
    const legacy = {
      appId: "old",
      appName: "Old",
      appVersion: "0.1.0",
      id: "id-1",
      token: crypto.createHash("sha256").update("secret").digest("hex"),
      metadata: { version: 1 }
    };
    const store = makeStore({ companionServerAuthTokens: Buffer.from(JSON.stringify([legacy])).toString("hex") });

    expect(isAuthValid(store, "secret")).toEqual([true, "id-1"]);
    expect(getAuthTokens(store)).toEqual([{ ...legacy, lastUsed: 5_000 }]);
  });

  it("still accepts the token when the stamp cannot be saved", () => {
    vi.useFakeTimers({ now: 0 });
    const store = makeStore();
    const token = createAuthToken(store, "app", "1.0.0", "App");
    vi.setSystemTime(LAST_USED_RESOLUTION_MS);
    safeStorage.encryptString.mockImplementationOnce(() => {
      throw new Error("locked");
    });

    expect(isAuthValid(store, token)[0]).toBe(true);
  });
});

describe("failed auth lockout", () => {
  afterEach(() => {
    clearFailedAuth("192.168.1.50");
  });

  it("locks a LAN address out after repeated failures and lets it back in later", () => {
    for (let i = 0; i < FAILED_AUTH_LIMIT - 1; i++) recordFailedAuth("192.168.1.50", 1000);
    expect(isAuthLockedOut("192.168.1.50", 1000)).toBe(false);

    recordFailedAuth("192.168.1.50", 1000);
    expect(isAuthLockedOut("192.168.1.50", 1000)).toBe(true);
    expect(isAuthLockedOut("192.168.1.50", 1000 + FAILED_AUTH_LOCKOUT_MS)).toBe(false);
  });

  it("never locks out loopback clients", () => {
    for (let i = 0; i < FAILED_AUTH_LIMIT * 2; i++) {
      recordFailedAuth("127.0.0.1", 1000);
      recordFailedAuth("::1", 1000);
      recordFailedAuth("::ffff:127.0.0.1", 1000);
    }
    expect(isAuthLockedOut("127.0.0.1", 1000)).toBe(false);
    expect(isAuthLockedOut("::1", 1000)).toBe(false);
    expect(isAuthLockedOut("::ffff:127.0.0.1", 1000)).toBe(false);
  });

  it("clears the count once an address pairs successfully", () => {
    for (let i = 0; i < FAILED_AUTH_LIMIT; i++) recordFailedAuth("192.168.1.50", 1000);
    clearFailedAuth("192.168.1.50");
    expect(isAuthLockedOut("192.168.1.50", 1000)).toBe(false);
  });
});
