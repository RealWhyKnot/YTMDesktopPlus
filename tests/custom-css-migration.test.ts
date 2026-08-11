import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { CUSTOM_CSS_ADDON_ID, migrateCustomCssSetting } from "../src/main/addons/migrate-custom-css";
import { scanExternalAddons } from "../src/main/addons/external-loader";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ytmd-css-migration-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("migrateCustomCssSetting", () => {
  it("copies the stylesheet into a valid addon folder", () => {
    const source = tempDir();
    const addonsDir = tempDir();
    const cssFile = path.join(source, "page.css");
    fs.writeFileSync(cssFile, "body { background: black; }");

    const result = migrateCustomCssSetting({ customCSSPath: cssFile, customCSSEnabled: true }, addonsDir);
    expect(result.migrated).toBe(true);
    if (!result.migrated) return;
    expect(result.enabled).toBe(true);
    expect(fs.readFileSync(path.join(result.addonDir, "styles.css"), "utf8")).toContain("background: black");

    // The generated folder must pass the same scan real addons go through
    const scans = scanExternalAddons(addonsDir);
    expect(scans).toHaveLength(1);
    expect(scans[0].error).toBeUndefined();
    expect(scans[0].manifest.id).toBe(CUSTOM_CSS_ADDON_ID);
    expect(scans[0].manifest.styles).toEqual(["styles.css"]);
  });

  it("keeps the disabled flag", () => {
    const source = tempDir();
    const addonsDir = tempDir();
    const cssFile = path.join(source, "page.css");
    fs.writeFileSync(cssFile, "body {}");

    const result = migrateCustomCssSetting({ customCSSPath: cssFile, customCSSEnabled: false }, addonsDir);
    expect(result).toMatchObject({ migrated: true, enabled: false });
  });

  it("does nothing without a usable path", () => {
    const addonsDir = tempDir();
    expect(migrateCustomCssSetting({ customCSSPath: null, customCSSEnabled: true }, addonsDir)).toEqual({ migrated: false });
    expect(migrateCustomCssSetting({ customCSSPath: path.join(addonsDir, "missing.css"), customCSSEnabled: true }, addonsDir)).toEqual({
      migrated: false
    });
  });

  it("never overwrites an existing migrated addon", () => {
    const source = tempDir();
    const addonsDir = tempDir();
    const cssFile = path.join(source, "page.css");
    fs.writeFileSync(cssFile, "body {}");

    expect(migrateCustomCssSetting({ customCSSPath: cssFile, customCSSEnabled: true }, addonsDir).migrated).toBe(true);
    expect(migrateCustomCssSetting({ customCSSPath: cssFile, customCSSEnabled: true }, addonsDir).migrated).toBe(false);
  });
});

describe("scanExternalAddons", () => {
  it("reports broken folders instead of throwing", () => {
    const addonsDir = tempDir();
    fs.mkdirSync(path.join(addonsDir, "no-manifest"));
    fs.mkdirSync(path.join(addonsDir, "bad-json"));
    fs.writeFileSync(path.join(addonsDir, "bad-json", "manifest.json"), "{nope");
    fs.mkdirSync(path.join(addonsDir, "wrong-id"));
    fs.writeFileSync(
      path.join(addonsDir, "wrong-id", "manifest.json"),
      JSON.stringify({ id: "other-id", name: "x", version: "1.0.0", author: "a", description: "d" })
    );

    const scans = scanExternalAddons(addonsDir);
    expect(scans).toHaveLength(3);
    for (const scan of scans) {
      expect(scan.error).toBeTruthy();
    }
  });

  it("returns nothing for a missing directory", () => {
    expect(scanExternalAddons(path.join(os.tmpdir(), "ytmd-does-not-exist-anywhere"))).toEqual([]);
  });
});
