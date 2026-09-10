import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { duplicateTheme, exportTheme } from "../src/main/themes/scaffold";
import { installThemeFromZip } from "../src/main/themes/install";
import { scanThemeFolder } from "../src/main/themes/loader";
import { makeTempDir } from "./helpers/temp-dir";

const tempDir = () => makeTempDir("ytmd-theme-scaffold-");

function sourceTheme(id = "sample"): string {
  const dir = path.join(tempDir(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "theme.json"),
    JSON.stringify({ id, name: "Sample", version: "1.0.0", author: "a", description: "d", styles: ["theme.css"] })
  );
  fs.writeFileSync(path.join(dir, "theme.css"), ":root{--bg:#101010}");
  fs.mkdirSync(path.join(dir, "fonts"));
  fs.writeFileSync(path.join(dir, "fonts", "f.woff2"), Buffer.from([1, 2, 3]));
  return dir;
}

describe("duplicateTheme", () => {
  it("copies under a fresh id that still scans clean", () => {
    const themesDir = tempDir();
    const result = duplicateTheme(sourceTheme(), themesDir);

    expect(result.duplicated).toBe(true);
    if (!("dir" in result)) return;
    expect(result.manifest.id).toBe("sample-copy");
    expect(result.manifest.name).toBe("Sample copy");

    const scan = scanThemeFolder(result.dir, "user");
    expect(scan.error).toBeUndefined();
    expect(scan.manifest?.id).toBe("sample-copy");
  });

  it("carries the theme's files across", () => {
    const themesDir = tempDir();
    const result = duplicateTheme(sourceTheme(), themesDir);
    if (!("dir" in result)) throw new Error("expected a copy");

    expect(fs.readFileSync(path.join(result.dir, "theme.css"), "utf8")).toContain("--bg");
    expect(fs.existsSync(path.join(result.dir, "fonts", "f.woff2"))).toBe(true);
  });

  it("does not collide when duplicated twice", () => {
    const themesDir = tempDir();
    const source = sourceTheme();

    duplicateTheme(source, themesDir);
    const second = duplicateTheme(source, themesDir);

    expect("dir" in second && path.basename(second.dir)).toBe("sample-copy-2");
  });

  it("reports a source without a manifest", () => {
    const result = duplicateTheme(tempDir(), tempDir());
    expect("reason" in result && result.reason).toContain("could not be read");
  });
});

describe("exportTheme", () => {
  it("round trips through install", () => {
    const destination = path.join(tempDir(), "sample.zip");
    expect(exportTheme(sourceTheme(), destination)).toEqual({ exported: true });

    const themesDir = tempDir();
    const installed = installThemeFromZip(destination, themesDir);

    expect(installed.installed).toBe(true);
    if (!("dir" in installed)) return;
    expect(fs.readFileSync(path.join(installed.dir, "theme.css"), "utf8")).toContain("--bg");
    expect(fs.existsSync(path.join(installed.dir, "fonts", "f.woff2"))).toBe(true);
  });

  it("refuses an empty folder", () => {
    const result = exportTheme(tempDir(), path.join(tempDir(), "out.zip"));
    expect("reason" in result && result.reason).toContain("empty");
  });
});
