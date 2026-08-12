import { describe, expect, it } from "vitest";
import { filterLogTailForAddon } from "../src/main/addons/log-tail";

describe("filterLogTailForAddon", () => {
  it("keeps only the scoped addon's lines", () => {
    const text = [
      "[2026-08-12 10:00:00.000][main][info] Addon active: rooms 1.0.0",
      "[2026-08-12 10:00:01.000][main][info] (addon:rooms) Audio stream enabled",
      "[2026-08-12 10:00:02.000][main][info] (addon:mobile-bridge) Mirroring phone playback",
      "[2026-08-12 10:00:03.000][main][error] (addon:rooms) Relay connection lost"
    ].join("\n");

    expect(filterLogTailForAddon(text, "rooms")).toEqual([
      "[2026-08-12 10:00:01.000][main][info] (addon:rooms) Audio stream enabled",
      "[2026-08-12 10:00:03.000][main][error] (addon:rooms) Relay connection lost"
    ]);
    expect(filterLogTailForAddon(text, "volume-boost")).toEqual([]);
  });
});
