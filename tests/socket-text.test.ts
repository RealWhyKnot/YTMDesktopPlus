import { describe, expect, it } from "vitest";
import { socketText } from "../src/shared/socket-text";

describe("socket text", () => {
  it("keeps text and UTF-8 buffers unchanged", () => {
    expect(socketText("hello")).toBe("hello");
    expect(socketText(Buffer.from("café"))).toBe("café");
  });

  it("keeps the original representations of other raw-data forms", () => {
    expect(socketText([Buffer.from("first"), Buffer.from("second")])).toBe("first,second");
    expect(socketText([])).toBe("");
    expect(socketText(new ArrayBuffer(4))).toBe("[object ArrayBuffer]");
  });
});
