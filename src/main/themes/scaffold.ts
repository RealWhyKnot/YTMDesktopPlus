import fs from "fs";
import path from "path";
import { zipSync } from "fflate";
import type { ThemeManifest } from "~shared/themes/sdk";
import { THEME_MANIFEST_NAME } from "./loader";
import { ALLOWED_THEME_EXTENSIONS } from "./install";
import { isThemeManifest } from "./validate-manifest";

export type DuplicateResult = { duplicated: true; manifest: ThemeManifest; dir: string } | { duplicated: false; reason: string };
export type CreateResult = { created: true; manifest: ThemeManifest; dir: string } | { created: false; reason: string };

import starterCss from "./starter.css?raw";

export function createTheme(themesDir: string): CreateResult {
  fs.mkdirSync(themesDir, { recursive: true });
  let id = "my-theme";
  let counter = 2;
  while (fs.existsSync(path.join(themesDir, id))) {
    id = `my-theme-${counter}`;
    counter += 1;
  }

  const dir = path.join(themesDir, id);
  const manifest: ThemeManifest = {
    id,
    name: "My theme",
    version: "0.1.0",
    author: "you",
    description: "One sentence about what it looks like.",
    apiVersion: 1,
    styles: ["theme.css"],
  };

  try {
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, THEME_MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    fs.writeFileSync(path.join(dir, "theme.css"), starterCss, "utf8");
  } catch (error) {
    return { created: false, reason: `the theme could not be created: ${String(error)}` };
  }
  return { created: true, manifest, dir };
}

function freeId(themesDir: string, baseId: string): string {
  const stem = baseId.replace(/-copy(-\d+)?$/, "");
  let candidate = `${stem}-copy`;
  let counter = 2;
  while (fs.existsSync(path.join(themesDir, candidate))) {
    candidate = `${stem}-copy-${counter}`;
    counter += 1;
  }
  return candidate;
}

export function duplicateTheme(sourceDir: string, themesDir: string): DuplicateResult {
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, THEME_MANIFEST_NAME), "utf8"));
  } catch (error) {
    return { duplicated: false, reason: `${THEME_MANIFEST_NAME} could not be read: ${String(error)}` };
  }

  if (!isThemeManifest(manifest)) return { duplicated: false, reason: `${THEME_MANIFEST_NAME} is invalid` };
  fs.mkdirSync(themesDir, { recursive: true });
  const id = freeId(themesDir, manifest.id);
  const target = path.join(themesDir, id);

  try {
    fs.cpSync(sourceDir, target, { recursive: true });
  } catch (error) {
    return { duplicated: false, reason: `the theme could not be copied: ${String(error)}` };
  }

  const copied: ThemeManifest = { ...manifest, id, name: `${manifest.name} copy` };
  fs.writeFileSync(path.join(target, THEME_MANIFEST_NAME), `${JSON.stringify(copied, null, 2)}\n`, "utf8");
  return { duplicated: true, manifest: copied, dir: target };
}

function collectFiles(root: string, prefix: string, into: Map<string, Uint8Array>): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collectFiles(absolute, relative, into);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!ALLOWED_THEME_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    into.set(relative, new Uint8Array(fs.readFileSync(absolute)));
  }
}

export function exportTheme(themeDir: string, destination: string): { exported: true } | { exported: false; reason: string } {
  const id = path.basename(themeDir);
  const files = new Map<string, Uint8Array>();
  try {
    collectFiles(themeDir, id, files);
  } catch (error) {
    return { exported: false, reason: `the theme could not be read: ${String(error)}` };
  }
  if (files.size === 0) return { exported: false, reason: "the theme folder is empty" };

  try {
    fs.writeFileSync(destination, Buffer.from(zipSync(Object.fromEntries(files))));
  } catch (error) {
    return { exported: false, reason: `the archive could not be written: ${String(error)}` };
  }
  return { exported: true };
}
