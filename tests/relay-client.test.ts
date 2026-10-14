import { describe, expect, it } from "vitest";
import { describeClose } from "../src/main/integrations/listen-along/relay-client";

describe("describeClose", () => {
  it("keeps the code, the reason and the socket error", () => {
    expect(describeClose(1008, Buffer.from("too many messages"), "")).toBe("1008 too many messages");
    expect(describeClose(1006, Buffer.alloc(0), "read ECONNRESET")).toBe("1006 (read ECONNRESET)");
    expect(describeClose(1005, Buffer.alloc(0), "")).toBe("1005");
  });
});
