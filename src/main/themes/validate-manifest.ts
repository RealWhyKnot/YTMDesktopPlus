import { THEME_API_VERSION, THEME_ID_PATTERN, type ThemeManifest } from "~shared/themes/sdk";
import { versionAtLeast } from "../addons/validate-manifest";

const SEMVER_SHAPE = /^\d+\.\d+\.\d+(-.+)?$/;
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const ADDON_ONLY_FIELDS = ["main", "ytmScripts", "defaultEnabled"] as const;
const STYLE_FIELDS = ["styles", "appStyles", "ytmStyles"] as const;

export function isContainedRelativePath(p: string): boolean {
  if (p.trim() === "") return false;
  if (p.startsWith("/") || p.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  return !p.split(/[\\/]/).includes("..");
}

export function validateThemeManifest(manifest: unknown): string | null {
  if (manifest === null || typeof manifest !== "object") return "manifest is not an object";
  const m = manifest as Record<string, unknown>;

  if (typeof m.id !== "string" || !THEME_ID_PATTERN.test(m.id)) return "id must be lowercase letters, digits and dashes";
  for (const field of ["name", "version", "author", "description"] as const) {
    if (typeof m[field] !== "string" || (m[field] as string).trim() === "") return `${field} is required`;
  }
  if (m.minAppVersion !== undefined && typeof m.minAppVersion !== "string") return "minAppVersion must be a string";
  if (m.homepage !== undefined && typeof m.homepage !== "string") return "homepage must be a string";
  if (m.apiVersion !== undefined && (typeof m.apiVersion !== "number" || !Number.isInteger(m.apiVersion) || m.apiVersion < 1)) {
    return "apiVersion must be a positive integer";
  }

  for (const field of ADDON_ONLY_FIELDS) {
    if (m[field] !== undefined) return `${field} belongs to an addon, not a theme: themes are CSS only`;
  }

  for (const field of STYLE_FIELDS) {
    const value = m[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some(entry => typeof entry !== "string")) return `${field} must be an array of relative paths`;
    if ((value as string[]).some(entry => !isContainedRelativePath(entry))) return `${field} paths must stay inside the theme folder`;
  }

  if (m.preview !== undefined) {
    if (typeof m.preview !== "string") return "preview must be a relative path";
    if (!isContainedRelativePath(m.preview)) return "preview must stay inside the theme folder";
  }

  if (m.titleBarOverlay !== undefined) {
    const overlay = m.titleBarOverlay as Record<string, unknown>;
    if (overlay === null || typeof overlay !== "object") return "titleBarOverlay must be an object";
    for (const key of ["color", "symbolColor"] as const) {
      if (typeof overlay[key] !== "string" || !HEX_COLOR.test(overlay[key] as string)) {
        return `titleBarOverlay.${key} must be a hex colour`;
      }
    }
  }

  return null;
}

export function themeManifestWarnings(manifest: ThemeManifest): string[] {
  const warnings: string[] = [];
  if (!SEMVER_SHAPE.test(manifest.version)) warnings.push(`version "${manifest.version}" is not semver shaped`);
  if (manifest.minAppVersion !== undefined && !SEMVER_SHAPE.test(manifest.minAppVersion)) {
    warnings.push(`minAppVersion "${manifest.minAppVersion}" is not semver shaped`);
  }
  if (manifest.homepage !== undefined && !/^https?:\/\//.test(manifest.homepage)) {
    warnings.push("homepage is not an http(s) link and will not be shown");
  }
  if (!manifest.styles?.length && !manifest.appStyles?.length && !manifest.ytmStyles?.length) {
    warnings.push("theme declares no stylesheets, so it changes nothing");
  }
  return warnings;
}

export function themeSatisfiesApp(manifest: ThemeManifest, appVersion: string): boolean {
  if (!manifest.minAppVersion) return true;
  return versionAtLeast(appVersion, manifest.minAppVersion);
}

export function themeApiSupported(manifest: ThemeManifest): boolean {
  return (manifest.apiVersion ?? 1) <= THEME_API_VERSION;
}
