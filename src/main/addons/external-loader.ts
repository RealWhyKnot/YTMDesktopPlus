import fs from "fs";
import path from "path";
import { createRequire } from "node:module";
import type { AddonManifest } from "~shared/addons/types";
import { manifestWarnings, validateManifest } from "./validate-manifest";
import type { BundledAddonDefinition } from "./manager";
import type { AddonInstance } from "./context";

export type ExternalAddonScan = {
  dir: string;
  folderName: string;
  manifest?: AddonManifest;
  error?: string;
  /** Non-fatal manifest problems, logged at registration */
  warnings?: string[];
};

/** Reads every folder in the addons directory and validates its manifest.
 *  Never throws: a broken folder comes back as an entry with an error. */
export function scanExternalAddons(addonsDir: string): ExternalAddonScan[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(addonsDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: ExternalAddonScan[] = [];
  for (const entry of entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const dir = path.join(addonsDir, entry.name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
    } catch (error) {
      results.push({ dir, folderName: entry.name, error: `manifest.json could not be read: ${error}` });
      continue;
    }
    const invalid = validateManifest(parsed);
    if (invalid) {
      results.push({ dir, folderName: entry.name, error: `manifest.json is invalid: ${invalid}` });
      continue;
    }
    const manifest = parsed as AddonManifest;
    if (manifest.id !== entry.name) {
      results.push({ dir, folderName: entry.name, manifest, error: "folder name must match the addon id" });
      continue;
    }
    const warnings = manifestWarnings(manifest);
    results.push({ dir, folderName: entry.name, manifest, warnings: warnings.length > 0 ? warnings : undefined });
  }
  return results;
}

/** Turns a scanned folder into a runnable definition. Styles are injected and
 *  watched; page scripts run on every view load; a main entry is required in
 *  and may export activate() for the full context. */
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
        const entry = requireFromAddon(path.join(dir, manifest.main));
        const activateFn = typeof entry === "function" ? entry : typeof entry?.activate === "function" ? entry.activate : entry?.default?.activate;
        if (typeof activateFn !== "function") {
          throw new Error(`${manifest.main} does not export an activate function`);
        }
        return (await activateFn(ctx)) as AddonInstance | undefined;
      }
    }
  };
}
