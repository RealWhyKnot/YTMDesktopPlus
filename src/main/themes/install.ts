import fs from "fs";
import path from "path";
import { unzipSync } from "fflate";
import type { ThemeManifest } from "~shared/themes/sdk";
import { THEME_MANIFEST_NAME } from "./loader";
import { validateThemeManifest } from "./validate-manifest";

export const ALLOWED_THEME_EXTENSIONS = new Set([".css", ".json", ".woff2", ".woff", ".ttf", ".otf", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".md", ".txt"]);

export const MAX_THEME_ENTRIES = 200;
export const MAX_THEME_BYTES = 32 * 1024 * 1024;

export type InstallResult = { installed: true; manifest: ThemeManifest; dir: string } | { installed: false; reason: string };

function isSafeEntryPath(name: string): boolean {
  if (name.includes("\\")) return false;
  if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return false;
  return !name.split("/").some(segment => segment === ".." || segment === "");
}

export function readThemeArchive(bytes: Uint8Array): { files: Map<string, Uint8Array> } | { reason: string } {
  let unzipped: Record<string, Uint8Array>;
  try {
    unzipped = unzipSync(bytes);
  } catch (error) {
    return { reason: `the archive could not be read: ${error}` };
  }

  const entries = Object.entries(unzipped).filter(([name]) => !name.endsWith("/"));
  if (entries.length === 0) return { reason: "the archive is empty" };
  if (entries.length > MAX_THEME_ENTRIES) return { reason: `the archive holds more than ${MAX_THEME_ENTRIES} files` };

  let total = 0;
  for (const [name, content] of entries) {
    if (!isSafeEntryPath(name)) return { reason: `the archive tries to write outside the theme folder: ${name}` };
    total += content.byteLength;
    if (total > MAX_THEME_BYTES) return { reason: "the archive unpacks to more than 32MB" };
  }

  const manifests = entries.map(([name]) => name).filter(name => path.posix.basename(name) === THEME_MANIFEST_NAME);
  if (manifests.length === 0) return { reason: `the archive has no ${THEME_MANIFEST_NAME}` };
  manifests.sort((a, b) => a.split("/").length - b.split("/").length);
  const prefixDir = path.posix.dirname(manifests[0]);
  const prefix = prefixDir === "." ? "" : `${prefixDir}/`;

  const files = new Map<string, Uint8Array>();
  for (const [name, content] of entries) {
    if (!name.startsWith(prefix)) continue;
    const relative = name.slice(prefix.length);
    if (relative === "") continue;
    if (!ALLOWED_THEME_EXTENSIONS.has(path.extname(relative).toLowerCase())) {
      return { reason: `the archive holds a file type themes may not carry: ${relative}` };
    }
    files.set(relative, content);
  }

  if (!files.has(THEME_MANIFEST_NAME)) return { reason: `the archive has no ${THEME_MANIFEST_NAME}` };
  return { files };
}

export function installThemeFromZip(zipPath: string, themesDir: string): InstallResult {
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(zipPath);
  } catch (error) {
    return { installed: false, reason: `the file could not be read: ${error}` };
  }

  const archive = readThemeArchive(new Uint8Array(bytes));
  if ("reason" in archive) return { installed: false, reason: archive.reason };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(archive.files.get(THEME_MANIFEST_NAME)!).toString("utf8"));
  } catch (error) {
    return { installed: false, reason: `${THEME_MANIFEST_NAME} could not be parsed: ${error}` };
  }
  const invalid = validateThemeManifest(parsed);
  if (invalid) return { installed: false, reason: `${THEME_MANIFEST_NAME} is invalid: ${invalid}` };

  const manifest = parsed as ThemeManifest;
  const target = path.join(themesDir, manifest.id);
  if (fs.existsSync(target)) return { installed: false, reason: `a theme with the id "${manifest.id}" is already installed` };

  fs.mkdirSync(target, { recursive: true });
  for (const [relative, content] of archive.files) {
    const destination = path.join(target, relative);
    if (path.relative(target, destination).startsWith("..")) {
      fs.rmSync(target, { recursive: true, force: true });
      return { installed: false, reason: `the archive tries to write outside the theme folder: ${relative}` };
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
  }

  return { installed: true, manifest, dir: target };
}
