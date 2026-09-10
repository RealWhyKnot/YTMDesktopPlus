import fs from "fs";
import path from "path";
import type { ThemeManifest, ThemeOrigin } from "~shared/themes/sdk";
import { themeManifestWarnings, validateThemeManifest } from "./validate-manifest";

export const THEME_MANIFEST_NAME = "theme.json";
export const BASE_LAYER_FOLDER = "_base";

export type ThemeScan = {
  dir: string;
  folderName: string;
  origin: ThemeOrigin;
  manifest?: ThemeManifest;
  error?: string;
  warnings?: string[];
};

export function scanThemeFolder(dir: string, origin: ThemeOrigin): ThemeScan {
  const folderName = path.basename(dir);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(dir, THEME_MANIFEST_NAME), "utf8"));
  } catch (error) {
    return { dir, folderName, origin, error: `${THEME_MANIFEST_NAME} could not be read: ${error}` };
  }
  const invalid = validateThemeManifest(parsed);
  if (invalid) {
    return { dir, folderName, origin, error: `${THEME_MANIFEST_NAME} is invalid: ${invalid}` };
  }
  const manifest = parsed as ThemeManifest;
  if (manifest.id !== folderName) {
    return { dir, folderName, origin, manifest, error: "folder name must match the theme id" };
  }
  const warnings = themeManifestWarnings(manifest);
  return { dir, folderName, origin, manifest, warnings: warnings.length > 0 ? warnings : undefined };
}

export function scanThemes(themesDir: string, origin: ThemeOrigin): ThemeScan[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(themesDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => scanThemeFolder(path.join(themesDir, entry.name), origin));
}
