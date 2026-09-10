import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AD_PLAYING_PATH,
  AD_PRUNE_CONTRACT,
  AD_RESPONSE_KEYS,
  AD_SKIP_SELECTORS,
  PLAYER_RESPONSE_MARKERS,
  UNKNOWN_AD_KEY_PATTERN
} from "../src/shared/ad-contract";

const SKIP_SCRIPT = "src/main/integrations/ad-blocker/script/enable.script.js";
const skipSource = readFileSync(SKIP_SCRIPT, "utf8");

const sourceFiles = readdirSync("src", { recursive: true })
  .map(String)
  .filter(name => /\.(ts|js|vue)$/.test(name))
  .map(name => join("src", name))
  .filter(path => path !== join("src", "shared", "ad-contract.ts"));

const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("ad response keys", () => {
  it("is sorted so additions stay reviewable", () => {
    expect([...AD_RESPONSE_KEYS]).toEqual([...AD_RESPONSE_KEYS].sort());
  });

  it.each([...AD_RESPONSE_KEYS])("no other source file hardcodes %s", key => {
    const offenders = sourceFiles.filter(path => {
      const source = stripComments(readFileSync(path, "utf8"));
      return source.includes(`"${key}"`) || source.includes(`'${key}'`);
    });

    expect(offenders).toEqual([]);
  });
});

describe("ad skip selectors", () => {
  it("match the list the page script queries", () => {
    const literal = /const SKIP_SELECTORS = \[([^\]]*)\]/.exec(skipSource);
    const selectors = literal?.[1].split(",").map(entry => entry.trim().replace(/^["']|["']$/g, ""));

    expect(selectors).toEqual([...AD_SKIP_SELECTORS]);
  });
});

describe("ad playing path", () => {
  it("is the store path the page script reads", () => {
    const [head] = AD_PLAYING_PATH.split(".");

    expect(skipSource).toContain(`getState().${head}`);
    expect(skipSource).toContain(AD_PLAYING_PATH);
  });
});

describe("UNKNOWN_AD_KEY_PATTERN", () => {
  it("matches plausible renames of the pruned keys", () => {
    for (const key of ["adBreaks", "adSignals", "adPlacementsV2", "adSlotsRenderer", "playerAdsV2"]) {
      expect(UNKNOWN_AD_KEY_PATTERN.test(key)).toBe(true);
    }
  });

  it("ignores the ordinary player response keys that start with ad", () => {
    for (const key of ["adaptiveFormats", "additionalData", "address", "ads", "playerConfig", "playabilityStatus"]) {
      expect(UNKNOWN_AD_KEY_PATTERN.test(key)).toBe(false);
    }
  });

  it("covers the keys the prune already removes", () => {
    for (const key of AD_RESPONSE_KEYS) expect(UNKNOWN_AD_KEY_PATTERN.test(key)).toBe(true);
  });
});

describe("AD_PRUNE_CONTRACT", () => {
  it("carries what the main world install needs", () => {
    expect(AD_PRUNE_CONTRACT.keys).toEqual([...AD_RESPONSE_KEYS]);
    expect(AD_PRUNE_CONTRACT.markers).toEqual([...PLAYER_RESPONSE_MARKERS]);
    expect(AD_PRUNE_CONTRACT.unknownKeyPattern).toBe(UNKNOWN_AD_KEY_PATTERN.source);
  });

  it("survives the structured clone executeInMainWorld puts it through", () => {
    expect(structuredClone(AD_PRUNE_CONTRACT)).toEqual(AD_PRUNE_CONTRACT);
  });
});
