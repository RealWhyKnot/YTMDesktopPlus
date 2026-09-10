import fs from "fs";
import path from "path";
import { isContainedRelativePath } from "./validate-manifest";

export type BundledCss = {
  css: string;
  warnings: string[];
};

const MAX_INLINE_BYTES = 4 * 1024 * 1024;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml"
};

const IMPORT_RULE = /@import\s+[^;]+;/g;
const URL_TOKEN = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/g;

export function inlineAsset(filePath: string): string | null {
  const mime = MIME_BY_EXTENSION[path.extname(filePath).toLowerCase()];
  if (!mime) return null;
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size > MAX_INLINE_BYTES) return null;
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

export function bundleThemeCss(css: string, themeDir: string): BundledCss {
  const warnings: string[] = [];
  const seen = new Set<string>();
  const warn = (message: string) => {
    if (seen.has(message)) return;
    seen.add(message);
    warnings.push(message);
  };

  const withoutImports = css.replace(IMPORT_RULE, () => {
    warn("@import was removed: a theme may not pull in stylesheets");
    return "";
  });

  const resolved = withoutImports.replace(URL_TOKEN, (match, double, single, bare) => {
    const raw = (double ?? single ?? bare ?? "").trim();
    if (raw === "") return match;
    if (raw.startsWith("data:")) return match;
    if (/^(https?:)?\/\//i.test(raw)) {
      warn(`remote url was removed: ${raw.slice(0, 80)}`);
      return "none";
    }
    if (raw.startsWith("#")) return match;

    const reference = raw.split(/[?#]/)[0];
    if (!isContainedRelativePath(reference)) {
      warn(`url must stay inside the theme folder: ${reference.slice(0, 80)}`);
      return "none";
    }

    const absolute = path.resolve(themeDir, reference);
    if (path.relative(themeDir, absolute).startsWith("..")) {
      warn(`url must stay inside the theme folder: ${reference.slice(0, 80)}`);
      return "none";
    }

    try {
      const dataUrl = inlineAsset(absolute);
      if (!dataUrl) {
        warn(`file could not be embedded: ${reference.slice(0, 80)}`);
        return "none";
      }
      return `url("${dataUrl}")`;
    } catch {
      warn(`file is missing: ${reference.slice(0, 80)}`);
      return "none";
    }
  });

  return { css: resolved, warnings };
}

export function bundleThemeFile(themeDir: string, relativePath: string): BundledCss {
  const absolute = path.resolve(themeDir, relativePath);
  if (path.relative(themeDir, absolute).startsWith("..")) {
    return { css: "", warnings: [`stylesheet must stay inside the theme folder: ${relativePath}`] };
  }
  try {
    return bundleThemeCss(fs.readFileSync(absolute, "utf8"), themeDir);
  } catch {
    return { css: "", warnings: [`stylesheet is missing: ${relativePath}`] };
  }
}
