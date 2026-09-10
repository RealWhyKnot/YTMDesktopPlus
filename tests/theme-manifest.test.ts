import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { themeApiSupported, themeManifestWarnings, themeSatisfiesApp, validateThemeManifest } from "../src/main/themes/validate-manifest";
import { scanThemeFolder, scanThemes } from "../src/main/themes/loader";
import type { ThemeManifest } from "~shared/themes/sdk";
import { makeTempDir } from "./helpers/temp-dir";

const tempDir = () => makeTempDir("ytmd-theme-manifest-");

const valid = (overrides: Record<string, unknown> = {}) => ({
  id: "sample",
  name: "Sample",
  version: "1.0.0",
  author: "a",
  description: "d",
  styles: ["theme.css"],
  ...overrides
});

function writeTheme(dir: string, folder: string, manifest: unknown): string {
  const themeDir = path.join(dir, folder);
  fs.mkdirSync(themeDir, { recursive: true });
  fs.writeFileSync(path.join(themeDir, "theme.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(themeDir, "theme.css"), ":root{--bg:#fff}");
  return themeDir;
}

describe("validateThemeManifest", () => {
  it("accepts a minimal theme", () => {
    expect(validateThemeManifest(valid())).toBeNull();
  });

  it.each([
    ["a non object", 42],
    ["a missing id", valid({ id: undefined })],
    ["an uppercase id", valid({ id: "Sample" })],
    ["a one character id", valid({ id: "a" })],
    ["a missing author", valid({ author: "" })],
    ["a zero apiVersion", valid({ apiVersion: 0 })],
    ["a non array styles", valid({ styles: "theme.css" })],
    ["a non hex overlay", valid({ titleBarOverlay: { color: "red", symbolColor: "#fff" } })]
  ])("rejects %s", (_label, manifest) => {
    expect(validateThemeManifest(manifest)).not.toBeNull();
  });

  it.each(["main", "ytmScripts", "defaultEnabled"])("rejects the addon field %s and says to use an addon", field => {
    const reason = validateThemeManifest(valid({ [field]: "index.js" }));
    expect(reason).toContain("belongs to an addon");
  });

  it.each([["styles"], ["appStyles"], ["ytmStyles"]])("refuses a %s path leaving the folder", field => {
    expect(validateThemeManifest(valid({ [field]: ["../outside.css"] }))).toContain("stay inside the theme folder");
    expect(validateThemeManifest(valid({ [field]: ["/etc/x.css"] }))).toContain("stay inside the theme folder");
    expect(validateThemeManifest(valid({ [field]: ["C:/x.css"] }))).toContain("stay inside the theme folder");
  });

  it("refuses a preview leaving the folder", () => {
    expect(validateThemeManifest(valid({ preview: "../secret.png" }))).toContain("stay inside the theme folder");
  });
});

describe("themeManifestWarnings", () => {
  it("warns about a loose version and a theme that styles nothing", () => {
    const warnings = themeManifestWarnings({ id: "x", name: "X", version: "1", author: "a", description: "d" } as ThemeManifest);
    expect(warnings.join(" ")).toContain("not semver shaped");
    expect(warnings.join(" ")).toContain("changes nothing");
  });

  it("stays quiet for a well formed theme", () => {
    expect(themeManifestWarnings(valid() as ThemeManifest)).toEqual([]);
  });
});

describe("compatibility gates", () => {
  it("holds a theme back from an older app", () => {
    const manifest = valid({ minAppVersion: "2026.910.0" }) as ThemeManifest;
    expect(themeSatisfiesApp(manifest, "2026.909.1")).toBe(false);
    expect(themeSatisfiesApp(manifest, "2026.910.0")).toBe(true);
  });

  it("refuses a newer theme API than this app serves", () => {
    expect(themeApiSupported(valid({ apiVersion: 2 }) as ThemeManifest)).toBe(false);
    expect(themeApiSupported(valid() as ThemeManifest)).toBe(true);
  });
});

describe("scanning", () => {
  it("requires the folder name to match the id", () => {
    const dir = tempDir();
    writeTheme(dir, "wrong-folder", valid());
    expect(scanThemeFolder(path.join(dir, "wrong-folder"), "user").error).toContain("folder name must match");
  });

  it("reports an unreadable manifest instead of throwing", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "broken"));
    expect(scanThemeFolder(path.join(dir, "broken"), "user").error).toContain("could not be read");
  });

  it("skips folders starting with an underscore or a dot", () => {
    const dir = tempDir();
    writeTheme(dir, "sample", valid());
    fs.mkdirSync(path.join(dir, "_base"));
    fs.mkdirSync(path.join(dir, ".git"));

    expect(scanThemes(dir, "user").map(scan => scan.folderName)).toEqual(["sample"]);
  });

  it("returns nothing for a missing directory", () => {
    expect(scanThemes(path.join(tempDir(), "nope"), "user")).toEqual([]);
  });
});
