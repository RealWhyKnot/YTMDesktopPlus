import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchResponse } from "../tools/test-harness/fetch-response.ts";
import { requireValue } from "./helpers/require-value";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("harness response deadline", () => {
  it("keeps the original deadline error and cancels only after it expires", async () => {
    let signal: AbortSignal | undefined;
    const response = fetchResponse(
      (value) => {
        signal = value;
        return new Promise<Response>((_, reject) =>
          value.addEventListener("abort", () => reject(value.reason instanceof Error ? value.reason : new Error("Request aborted")))
        );
      },
      3000,
      "list targets"
    );
    const result = expect(response).rejects.toThrow("timeout after 3000ms: list targets");
    await vi.advanceTimersByTimeAsync(2999);
    expect(requireValue(signal).aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(requireValue(signal).aborted).toBe(true);
  });

  it("leaves body consumption unrestricted once headers arrive", async () => {
    let signal: AbortSignal | undefined;
    const expected = new Response("body");
    const response = await fetchResponse(
      (value) => {
        signal = value;
        return Promise.resolve(expected);
      },
      2000,
      "probe"
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(response).toBe(expected);
    expect(requireValue(signal).aborted).toBe(false);
    expect(await response.text()).toBe("body");
  });
});
