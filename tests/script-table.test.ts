import { describe, expect, it } from "vitest";
import { mergeScript, type ScriptTable } from "../src/renderer/ytmview/script-table";
import { serializeYtmScripts } from "../src/main/addons/script-table";

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

describe("script snapshots", () => {
  it("preserves assignment behavior for inherited names and integer keys", () => {
    const scripts = new Map<string, string>([
      ["banner", "() => 1"],
      ["__proto__", "() => 2"],
      ["constructor", "() => 3"],
      ["toString", "() => 4"],
      ["1", "() => 5"],
      ["0", "() => 6"],
    ]);
    const legacy = {};
    for (const [name, script] of scripts) Reflect.set(legacy, name, script);
    const snapshot = serializeYtmScripts(new Map([["addon:sample", scripts]]));
    expect(JSON.stringify(snapshot)).toBe(JSON.stringify({ "addon:sample": legacy }));
    expect(snapshot["addon:sample"]).toEqual(legacy);
    expect(Object.hasOwn(legacy, "__proto__")).toBe(false);
  });
});
