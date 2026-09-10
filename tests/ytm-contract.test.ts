import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLAYER_API_DUCK_TYPE, PLAYER_API_MEMBERS, PLAYER_API_RESOLVER_PATTERN, missingPlayerApiMembers } from "../src/shared/ytm-contract";

const sourceFiles = readdirSync("src", { recursive: true })
  .map(String)
  .filter(name => /\.(ts|js|vue)$/.test(name))
  .map(name => join("src", name));

const used = new Map<string, string[]>();
for (const path of sourceFiles) {
  for (const match of readFileSync(path, "utf8").matchAll(/playerApi\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
    const member = match[1];
    if (!used.has(member)) used.set(member, []);
    used.get(member)?.push(path);
  }
}

describe("player api contract", () => {
  it("finds direct playerApi calls in the source", () => {
    expect(used.size).toBeGreaterThan(5);
  });

  it("covers every directly called member", () => {
    const uncovered = [...used.entries()].filter(([member]) => !(PLAYER_API_MEMBERS as readonly string[]).includes(member));
    expect(uncovered.map(([member, paths]) => `${member} (${paths.join(", ")})`)).toEqual([]);
  });

  it("keeps the duck type inside the audited members", () => {
    for (const name of PLAYER_API_DUCK_TYPE) expect(PLAYER_API_MEMBERS).toContain(name);
  });

  it("is sorted so additions stay reviewable", () => {
    expect([...PLAYER_API_MEMBERS]).toEqual([...PLAYER_API_MEMBERS].sort());
  });
});

describe("missingPlayerApiMembers", () => {
  it("returns nothing for a complete api", () => {
    const api = Object.fromEntries(PLAYER_API_MEMBERS.map(name => [name, (): void => undefined]));
    expect(missingPlayerApiMembers(api)).toEqual([]);
  });

  it("names the members that are not functions", () => {
    const api = Object.fromEntries(PLAYER_API_MEMBERS.map(name => [name, (): void => undefined]));
    delete api.getVolume;
    api.seekTo = 3 as unknown as () => void;
    expect(missingPlayerApiMembers(api)).toEqual(["getVolume", "seekTo"]);
  });

  it("stays quiet when there is no api at all", () => {
    expect(missingPlayerApiMembers(null)).toEqual([]);
    expect(missingPlayerApiMembers(undefined)).toEqual([]);
  });
});

describe("PLAYER_API_RESOLVER_PATTERN", () => {
  it("matches the known resolver and plausible renames", () => {
    for (const name of ["resolvePlayerApi", "getPlayerApi", "fetchPlayerApi", "ensurePlayerApi", "getPlayer", "loadApi"]) {
      expect(PLAYER_API_RESOLVER_PATTERN.test(name)).toBe(true);
    }
  });

  it("does not match event handlers or unrelated methods", () => {
    for (const name of ["onPlayerApiReady", "playerApiChanged_", "refitPopups_", "dispatch"]) {
      expect(PLAYER_API_RESOLVER_PATTERN.test(name)).toBe(false);
    }
  });
});
