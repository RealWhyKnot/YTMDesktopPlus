import type { AddonManifest } from "~shared/addons/sdk";
import { isArray, isRecord } from "~shared/unknown";
import { readDecimalIntegerPrefix } from "~shared/integer-prefix";

export const ADDON_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

export const SUPPORTED_ADDON_API_VERSION = 1;

const SEMVER_SHAPE = /^\d+\.\d+\.\d+(-.+)?$/;

export const MANIFEST_TEXT_LIMITS = { name: 64, author: 64, version: 32, description: 300, minAppVersion: 32, homepage: 2048 } as const;

export function manifestTextTooLong(m: Record<string, unknown>): string | null {
  for (const [field, limit] of Object.entries(MANIFEST_TEXT_LIMITS)) {
    const value = m[field];
    if (typeof value === "string" && Array.from(value).length > limit) return `${field} is longer than ${limit} characters`;
  }
  return null;
}

export function validateManifest(manifest: unknown): string | null {
  if (!isRecord(manifest)) return "manifest is not an object";
  const m = manifest;

  if (typeof m.id !== "string" || !ADDON_ID_PATTERN.test(m.id)) return "id must be lowercase letters, digits and dashes";
  for (const field of ["name", "version", "author", "description"] as const) {
    if (typeof m[field] !== "string" || m[field].trim() === "") return `${field} is required`;
  }
  if (m.minAppVersion !== undefined && typeof m.minAppVersion !== "string") return "minAppVersion must be a string";
  if (m.homepage !== undefined && typeof m.homepage !== "string") return "homepage must be a string";
  if (m.defaultEnabled !== undefined && typeof m.defaultEnabled !== "boolean") return "defaultEnabled must be a boolean";
  const tooLong = manifestTextTooLong(m);
  if (tooLong) return tooLong;
  if (m.apiVersion !== undefined && (typeof m.apiVersion !== "number" || !Number.isInteger(m.apiVersion) || m.apiVersion < 1)) {
    return "apiVersion must be a positive integer";
  }
  if (m.main !== undefined && typeof m.main !== "string") return "main must be a relative path";
  for (const field of ["styles", "ytmScripts"] as const) {
    const value = m[field];
    if (value === undefined) continue;
    if (!isArray(value) || !value.every((entry) => typeof entry === "string")) return `${field} must be an array of relative paths`;
  }
  for (const field of ["main", "styles", "ytmScripts"] as const) {
    const value = m[field];
    const paths = typeof value === "string" ? [value] : isArray(value) ? value : [];
    for (const p of paths) {
      if (typeof p !== "string") return `${field} must be an array of relative paths`;
      if (p.includes("..") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return `${field} paths must stay inside the addon folder`;
    }
  }
  return null;
}

export function isAddonManifest(value: unknown): value is AddonManifest {
  return validateManifest(value) === null;
}

export function manifestWarnings(manifest: AddonManifest): string[] {
  const warnings: string[] = [];
  if (!SEMVER_SHAPE.test(manifest.version)) warnings.push(`version "${manifest.version}" is not semver shaped`);
  if (manifest.minAppVersion !== undefined && !SEMVER_SHAPE.test(manifest.minAppVersion)) {
    warnings.push(`minAppVersion "${manifest.minAppVersion}" is not semver shaped`);
  }
  if (manifest.homepage !== undefined && !/^https?:\/\//.test(manifest.homepage)) {
    warnings.push("homepage is not an http(s) link and will not be shown");
  }
  return warnings;
}

export function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (v: string) => (v.split("-")[0] ?? "").split(".").map((part) => readDecimalIntegerPrefix(part) || 0);
  const a = parse(version);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

export function manifestSatisfiesApp(manifest: AddonManifest, appVersion: string): boolean {
  if (!manifest.minAppVersion) return true;
  return versionAtLeast(appVersion, manifest.minAppVersion);
}
