import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import { APIV1CommandRequestBody } from "../src/main/integrations/companion-server/api-shared/schemas";

const isValid = (body: unknown) => Value.Check(APIV1CommandRequestBody, body);

describe("APIV1CommandRequestBody", () => {
  it("accepts bare commands", () => {
    expect(isValid({ command: "playPause" })).toBe(true);
    expect(isValid({ command: "next" })).toBe(true);
    expect(isValid({ command: "toggleLike" })).toBe(true);
  });

  it("enforces setVolume bounds", () => {
    expect(isValid({ command: "setVolume", data: 0 })).toBe(true);
    expect(isValid({ command: "setVolume", data: 100 })).toBe(true);
    expect(isValid({ command: "setVolume", data: 101 })).toBe(false);
    expect(isValid({ command: "setVolume", data: -1 })).toBe(false);
    expect(isValid({ command: "setVolume" })).toBe(false);
  });

  it("rejects unknown commands", () => {
    expect(isValid({ command: "selfDestruct" })).toBe(false);
    expect(isValid({})).toBe(false);
  });

  it("rejects negative seeks", () => {
    expect(isValid({ command: "seekTo", data: -5 })).toBe(false);
    expect(isValid({ command: "seekTo", data: 30 })).toBe(true);
  });
});
