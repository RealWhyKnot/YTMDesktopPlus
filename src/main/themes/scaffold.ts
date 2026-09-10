import fs from "fs";
import path from "path";
import { zipSync } from "fflate";
import type { ThemeManifest } from "~shared/themes/sdk";
import { THEME_MANIFEST_NAME } from "./loader";
import { ALLOWED_THEME_EXTENSIONS } from "./install";

export type DuplicateResult = { duplicated: true; manifest: ThemeManifest; dir: string } | { duplicated: false; reason: string };

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
  let manifest: ThemeManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, THEME_MANIFEST_NAME), "utf8")) as ThemeManifest;
  } catch (error) {
    return { duplicated: false, reason: `${THEME_MANIFEST_NAME} could not be read: ${error}` };
  }

  fs.mkdirSync(themesDir, { recursive: true });
  const id = freeId(themesDir, manifest.id);
  const target = path.join(themesDir, id);

  try {
    fs.cpSync(sourceDir, target, { recursive: true });
  } catch (error) {
    return { duplicated: false, reason: `the theme could not be copied: ${error}` };
  }

  const copied: ThemeManifest = { ...manifest, id, name: `${manifest.name} copy` };
  fs.writeFileSync(path.join(target, THEME_MANIFEST_NAME), `${JSON.stringify(copied, null, 2)}\n`, "utf8");
  return { duplicated: true, manifest: copied, dir: target };
}

function collectFiles(root: string, prefix: string, into: Record<string, Uint8Array>): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      collectFiles(absolute, relative, into);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!ALLOWED_THEME_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
    into[relative] = new Uint8Array(fs.readFileSync(absolute));
  }
}

export function exportTheme(themeDir: string, destination: string): { exported: true } | { exported: false; reason: string } {
  const id = path.basename(themeDir);
  const files: Record<string, Uint8Array> = {};
  try {
    collectFiles(themeDir, id, files);
  } catch (error) {
    return { exported: false, reason: `the theme could not be read: ${error}` };
  }
  if (Object.keys(files).length === 0) return { exported: false, reason: "the theme folder is empty" };

  try {
    fs.writeFileSync(destination, Buffer.from(zipSync(files)));
  } catch (error) {
    return { exported: false, reason: `the archive could not be written: ${error}` };
  }
  return { exported: true };
}
