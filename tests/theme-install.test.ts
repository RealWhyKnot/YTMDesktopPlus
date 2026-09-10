import fs from "fs";
import path from "path";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { installThemeFromZip, readThemeArchive, MAX_THEME_ENTRIES } from "../src/main/themes/install";
import { makeTempDir } from "./helpers/temp-dir";

const tempDir = () => makeTempDir("ytmd-theme-install-");
const bytes = (text: string) => new TextEncoder().encode(text);

const manifest = (id = "sample") => JSON.stringify({ id, name: "Sample", version: "1.0.0", author: "a", description: "d", appStyles: ["app.css"] });

function writeZip(dir: string, files: Record<string, Uint8Array>): string {
  const zipPath = path.join(dir, "theme.zip");
  fs.writeFileSync(zipPath, Buffer.from(zipSync(files)));
  return zipPath;
}

describe("readThemeArchive", () => {
  it("refuses an entry escaping the theme folder", () => {
    const archive = readThemeArchive(zipSync({ "theme.json": bytes(manifest()), "../evil.css": bytes("x") }));
    expect("reason" in archive && archive.reason).toContain("outside the theme folder");
  });

  it("refuses an absolute entry path", () => {
    const archive = readThemeArchive(zipSync({ "theme.json": bytes(manifest()), "/etc/evil.css": bytes("x") }));
    expect("reason" in archive && archive.reason).toContain("outside the theme folder");
  });

  it("refuses a file type themes may not carry", () => {
    const archive = readThemeArchive(zipSync({ "theme.json": bytes(manifest()), "payload.js": bytes("x") }));
    expect("reason" in archive && archive.reason).toContain("may not carry");
  });

  it("refuses an archive with too many entries", () => {
    const files: Record<string, Uint8Array> = { "theme.json": bytes(manifest()) };
    for (let i = 0; i < MAX_THEME_ENTRIES + 1; i++) files[`f${i}.css`] = bytes("a");
    const archive = readThemeArchive(zipSync(files));
    expect("reason" in archive && archive.reason).toContain("more than");
  });

  it("refuses an archive with no manifest", () => {
    const archive = readThemeArchive(zipSync({ "app.css": bytes("a{}") }));
    expect("reason" in archive && archive.reason).toContain("no theme.json");
  });

  it("flattens a single wrapping folder", () => {
    const archive = readThemeArchive(zipSync({ "sample/theme.json": bytes(manifest()), "sample/app.css": bytes("a{}") }));
    expect("files" in archive && [...archive.files.keys()].sort()).toEqual(["app.css", "theme.json"]);
  });
});

describe("installThemeFromZip", () => {
  it("installs into a folder named for the id", () => {
    const dir = tempDir();
    const themesDir = tempDir();
    const zipPath = writeZip(dir, { "theme.json": bytes(manifest()), "app.css": bytes(":root{--bg:#fff}") });

    const result = installThemeFromZip(zipPath, themesDir);

    expect(result.installed).toBe(true);
    if (!result.installed) return;
    expect(result.manifest.id).toBe("sample");
    expect(fs.readFileSync(path.join(themesDir, "sample", "app.css"), "utf8")).toContain("--bg");
  });

  it("refuses to overwrite an installed theme", () => {
    const dir = tempDir();
    const themesDir = tempDir();
    fs.mkdirSync(path.join(themesDir, "sample"));
    const zipPath = writeZip(dir, { "theme.json": bytes(manifest()) });

    const result = installThemeFromZip(zipPath, themesDir);

    expect(result.installed).toBe(false);
    if (!("reason" in result)) return;
    expect(result.reason).toContain("already installed");
  });

  it("refuses an invalid manifest", () => {
    const dir = tempDir();
    const zipPath = writeZip(dir, { "theme.json": bytes(JSON.stringify({ id: "Bad Id" })) });
    const result = installThemeFromZip(zipPath, tempDir());
    expect(result.installed).toBe(false);
  });

  it("refuses a manifest carrying addon fields", () => {
    const dir = tempDir();
    const bad = JSON.stringify({ id: "xx", name: "X", version: "1.0.0", author: "a", description: "d", main: "index.js" });
    const zipPath = writeZip(dir, { "theme.json": bytes(bad) });

    const result = installThemeFromZip(zipPath, tempDir());

    expect(result.installed).toBe(false);
    if (!("reason" in result)) return;
    expect(result.reason).toContain("belongs to an addon");
  });
});
