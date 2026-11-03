import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import type { AddonManifest, AddonContext, AddonInstance } from "~shared/addons/sdk";
import { isAddonManifest, manifestWarnings, validateManifest } from "./validate-manifest";
import type { BundledAddonDefinition } from "./managed-addon";
import { isRecord } from "~shared/unknown";

function isActivation(value: unknown): value is (context: AddonContext) => unknown {
  return typeof value === "function";
}

function isAddonInstance(value: unknown): value is AddonInstance {
  return isRecord(value) && (value.destroy === undefined || typeof value.destroy === "function");
}

export type ExternalAddonScan = {
  dir: string;
  folderName: string;
  manifest?: AddonManifest;
  error?: string;

  warnings?: string[];
  fingerprint?: string;
};

function fingerprintAddon(dir: string, manifestBytes: Buffer, manifest: AddonManifest): string {
  const hash = createHash("sha256");
  hash.update(`manifest.json\0${manifestBytes.length}\0`).update(manifestBytes);
  for (const relative of [manifest.main, ...(manifest.ytmScripts ?? [])]) {
    if (!relative) continue;
    let bytes: Buffer;
    try {
      bytes = fs.readFileSync(path.join(dir, relative));
    } catch {
      hash.update(`${relative}\0missing\0`);
      continue;
    }
    hash.update(`${relative}\0${bytes.length}\0`).update(bytes);
  }
  return hash.digest("hex");
}

export function scanAddonFolder(dir: string): ExternalAddonScan {
  const folderName = path.basename(dir);
  let parsed: unknown;
  let manifestBytes: Buffer;
  try {
    manifestBytes = fs.readFileSync(path.join(dir, "manifest.json"));
    parsed = JSON.parse(manifestBytes.toString("utf8"));
  } catch (error) {
    return { dir, folderName, error: `manifest.json could not be read: ${String(error)}` };
  }
  const invalid = validateManifest(parsed);
  if (invalid || !isAddonManifest(parsed)) {
    return { dir, folderName, error: `manifest.json is invalid: ${invalid}` };
  }
  const manifest = parsed;
  if (manifest.id !== folderName) {
    return { dir, folderName, manifest, error: "folder name must match the addon id" };
  }
  const warnings = manifestWarnings(manifest);
  return { dir, folderName, manifest, warnings: warnings.length > 0 ? warnings : undefined, fingerprint: fingerprintAddon(dir, manifestBytes, manifest) };
}

export function scanExternalAddons(addonsDir: string): ExternalAddonScan[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(addonsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => scanAddonFolder(path.join(addonsDir, entry.name)));
}

export function bustAddonRequireCache(dir: string): void {
  const requireFromAddon = createRequire(path.join(dir, "manifest.json"));
  const prefix = path.normalize(dir + path.sep).toLowerCase();
  for (const key of Object.keys(requireFromAddon.cache)) {
    if (path.normalize(key).toLowerCase().startsWith(prefix)) {
      Reflect.deleteProperty(requireFromAddon.cache, key);
    }
  }
}

export function buildExternalDefinition(dir: string, manifest: AddonManifest): BundledAddonDefinition {
  return {
    manifest,
    async activate(ctx) {
      for (const style of manifest.styles ?? []) {
        ctx.ytmview.watchCSSFile(path.join(dir, style));
      }
      for (const scriptRelative of manifest.ytmScripts ?? []) {
        const name = path.basename(scriptRelative).replace(/\.[^.]*$/, "");
        const source = fs.readFileSync(path.join(dir, scriptRelative), "utf8");
        ctx.ytmview.registerScript(name, source);
        ctx.ytmview.onLoaded(() => ctx.ytmview.runScript(name));
      }
      if (manifest.main) {
        const requireFromAddon = createRequire(path.join(dir, "manifest.json"));
        const entry: unknown = requireFromAddon(path.join(dir, manifest.main));
        const direct = isRecord(entry) ? entry.activate : undefined;
        const fallback = isRecord(entry) && isRecord(entry.default) ? entry.default.activate : undefined;
        const activateFn = isActivation(entry) ? entry : isActivation(direct) ? direct : fallback;
        if (!isActivation(activateFn)) {
          throw new Error(`${manifest.main} does not export an activate function`);
        }
        const instance = await activateFn(ctx);
        if (instance === undefined || instance === null) return undefined;
        if (!isAddonInstance(instance)) throw new TypeError(`${manifest.main} returned an invalid addon instance`);
        return instance;
      }
      return undefined;
    },
  };
}
