import { describe, expect, it } from "vitest";
import { mergeScript, type ScriptTable } from "../src/renderer/ytmview/script-table";

describe("mergeScript", () => {
  it("creates namespaces, replaces same-name scripts and stays idempotent", () => {
    const table: ScriptTable = {};

    mergeScript(table, "addon:sample", "banner", "() => 1");
    expect(table).toEqual({ "addon:sample": { banner: "() => 1" } });

    mergeScript(table, "addon:sample", "banner", "() => 2");
    mergeScript(table, "addon:sample", "banner", "() => 2");
    expect(table).toEqual({ "addon:sample": { banner: "() => 2" } });

    mergeScript(table, "addon-host", "innertubeRequest", "() => 3");
    expect(Object.keys(table).sort()).toEqual(["addon-host", "addon:sample"]);
  });
});
