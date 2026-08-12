import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAYER_BAR_SELECTOR } from "../src/shared/hook-probes";

// Raw page scripts cannot import the shared constant, so hold their selector
// literals to it here instead of templating injected code.
const scriptFiles = readdirSync("src", { recursive: true })
  .map(String)
  .filter(name => name.endsWith(".script.js"))
  .map(name => join("src", name));

// Bare "ytmusic-player-bar" appears legitimately (class adds, broader addon
// selectors); only the layout-prefixed form must stay canonical.
const referencing = scriptFiles.filter(path => readFileSync(path, "utf8").includes("ytmusic-app-layout")).map(path => ({ path }));

describe("player bar selector", () => {
  it("is referenced by at least one raw script", () => {
    expect(referencing.length).toBeGreaterThan(0);
  });

  it.each(referencing)("$path uses the canonical selector", ({ path }) => {
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/ytmusic-app-layout\s*>?\s*ytmusic-player-bar/g)) {
      expect(match[0]).toBe(PLAYER_BAR_SELECTOR);
    }
  });

  it("togglerating template keeps its rating placeholders", () => {
    const source = readFileSync("src/renderer/ytmview/scripts/togglerating.script.js", "utf8");
    expect(source).toContain("__RATING__");
    expect(source).toContain("__OPPOSITE__");
  });
});
