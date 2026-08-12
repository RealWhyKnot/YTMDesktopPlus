import type { AddonManifest } from "~shared/addons/types";

export const ADDON_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** The addon API generation this app serves. Additive context growth never
 *  bumps it; only a break in existing surface would. */
export const SUPPORTED_ADDON_API_VERSION = 1;

const SEMVER_SHAPE = /^\d+\.\d+\.\d+(-.+)?$/;

/** Returns the reason the manifest is invalid, or null when it is usable. */
export function validateManifest(manifest: unknown): string | null {
  if (manifest === null || typeof manifest !== "object") return "manifest is not an object";
  const m = manifest as Record<string, unknown>;

  if (typeof m.id !== "string" || !ADDON_ID_PATTERN.test(m.id)) return "id must be lowercase letters, digits and dashes";
  for (const field of ["name", "version", "author", "description"] as const) {
    if (typeof m[field] !== "string" || (m[field] as string).trim() === "") return `${field} is required`;
  }
  if (m.minAppVersion !== undefined && typeof m.minAppVersion !== "string") return "minAppVersion must be a string";
  if (m.homepage !== undefined && typeof m.homepage !== "string") return "homepage must be a string";
  if (m.apiVersion !== undefined && (typeof m.apiVersion !== "number" || !Number.isInteger(m.apiVersion) || m.apiVersion < 1)) {
    return "apiVersion must be a positive integer";
  }
  if (m.main !== undefined && typeof m.main !== "string") return "main must be a relative path";
  for (const field of ["styles", "ytmScripts"] as const) {
    const value = m[field];
    if (value === undefined) continue;
    if (!Array.isArray(value) || value.some(entry => typeof entry !== "string")) return `${field} must be an array of relative paths`;
  }
  for (const field of ["main", "styles", "ytmScripts"] as const) {
    const paths = field === "main" ? (m.main ? [m.main as string] : []) : ((m[field] as string[] | undefined) ?? []);
    for (const p of paths) {
      if (p.includes("..") || p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return `${field} paths must stay inside the addon folder`;
    }
  }
  return null;
}

/** Non-fatal manifest problems worth telling the author about in the log. */
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

/** Loose semver-style compare on the numeric dot parts; prerelease tags are ignored. */
export function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (v: string) =>
    v
      .split("-")[0]
      .split(".")
      .map(part => Number.parseInt(part, 10) || 0);
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
