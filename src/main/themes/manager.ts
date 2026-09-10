import fs from "fs";
import path from "path";
import type { ActiveTheme, ThemeCss, ThemeDescriptor, ThemeManifest, ThemeTokens } from "~shared/themes/sdk";
import { bundleThemeFile, inlineAsset } from "./css-bundle";
import { BASE_LAYER_FOLDER, scanThemes, type ThemeScan } from "./loader";
import { themeApiSupported, themeSatisfiesApp } from "./validate-manifest";
import { duplicateTheme, exportTheme } from "./scaffold";
import { installThemeFromZip } from "./install";

export const DEFAULT_TITLE_BAR_OVERLAY = { color: "#000000", symbolColor: "#BBBBBB", height: 36 };

const ROOT_BLOCK = /:root\s*\{([^}]*)\}/g;
const TOKEN_DECLARATION = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+)/g;
const WATCH_DEBOUNCE_MS = 120;

type StyleField = "styles" | "appStyles" | "ytmStyles";

export type ThemeManagerServices = {
  bundledThemesDir: string;
  userThemesDir: string;
  appVersion: string;
  getActiveId(): string | null;
  setActiveId(id: string | null): void;
  onChanged(css: ThemeCss, active: ActiveTheme): void;
  log: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
};

type LoadedTheme = {
  scan: ThemeScan;
  descriptor: ThemeDescriptor;
};

export function parseTokens(css: string): ThemeTokens {
  const tokens: ThemeTokens = {};
  for (const block of css.matchAll(ROOT_BLOCK)) {
    for (const declaration of block[1].matchAll(TOKEN_DECLARATION)) {
      tokens["--" + declaration[1]] = declaration[2].trim();
    }
  }
  return tokens;
}

export class ThemeManager {
  private themes: LoadedTheme[] = [];
  private css: ThemeCss = { app: "", ytm: "", addonWindow: "" };
  private tokens: ThemeTokens = {};
  private watchers: fs.FSWatcher[] = [];
  private rebuildTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<(theme: ActiveTheme) => void>();

  constructor(private services: ThemeManagerServices) {}

  public refresh(): void {
    const bundled = scanThemes(this.services.bundledThemesDir, "bundled");
    const user = scanThemes(this.services.userThemesDir, "user");
    const seen = new Set<string>();

    this.themes = [];
    for (const scan of [...bundled, ...user]) {
      const id = scan.manifest?.id ?? scan.folderName;
      if (seen.has(id)) {
        this.themes.push({ scan, descriptor: this.describe(scan, "id conflicts with an installed theme") });
        continue;
      }
      seen.add(id);
      this.themes.push({ scan, descriptor: this.describe(scan) });
    }

    this.rebuild();
  }

  private describe(scan: ThemeScan, conflict?: string): ThemeDescriptor {
    const fallback: ThemeManifest = { id: scan.folderName, name: scan.folderName, version: "0.0.0", author: "", description: "" };
    const manifest = scan.manifest ?? fallback;
    const error = conflict ?? scan.error;
    let state: ThemeDescriptor["state"] = error ? "error" : "ok";
    let message = error;

    if (!error && scan.manifest) {
      if (!themeApiSupported(scan.manifest)) {
        state = "incompatible";
        message = "theme targets a newer theme API than this app serves";
      } else if (!themeSatisfiesApp(scan.manifest, this.services.appVersion)) {
        state = "incompatible";
        message = "theme needs app version " + scan.manifest.minAppVersion + " or newer";
      }
    }

    return {
      manifest,
      origin: scan.origin,
      active: false,
      state,
      error: message,
      warnings: scan.warnings ?? [],
      previewDataUrl: this.previewFor(scan),
      swatch: this.swatchFor(scan),
      watching: false
    };
  }

  private swatchFor(scan: ThemeScan): string[] {
    const base = parseTokens(this.baseFile("app.css"));
    const own: ThemeTokens = {};
    for (const field of ["styles", "appStyles"] as const) {
      for (const relative of scan.manifest?.[field] ?? []) {
        try {
          Object.assign(own, parseTokens(fs.readFileSync(path.resolve(scan.dir, relative), "utf8")));
        } catch {
          continue;
        }
      }
    }
    const pick = (token: string) => own[token] ?? base[token] ?? "transparent";
    return [pick("--bg"), pick("--bg-control"), pick("--accent")];
  }

  private previewFor(scan: ThemeScan): string | undefined {
    if (!scan.manifest?.preview) return undefined;
    try {
      return inlineAsset(path.resolve(scan.dir, scan.manifest.preview)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private baseFile(name: string): string {
    return bundleThemeFile(path.join(this.services.bundledThemesDir, BASE_LAYER_FOLDER), name).css;
  }

  private collect(theme: LoadedTheme | null, fields: StyleField[]): { css: string; warnings: string[] } {
    if (!theme?.scan.manifest) return { css: "", warnings: [] };
    const parts: string[] = [];
    const warnings: string[] = [];
    for (const field of fields) {
      for (const relative of theme.scan.manifest[field] ?? []) {
        const bundled = bundleThemeFile(theme.scan.dir, relative);
        parts.push(bundled.css);
        warnings.push(...bundled.warnings);
      }
    }
    return { css: parts.join("\n"), warnings };
  }

  private rebuild(): void {
    const activeId = this.services.getActiveId();
    const active = this.themes.find(theme => theme.descriptor.manifest.id === activeId && theme.descriptor.state === "ok") ?? null;

    for (const theme of this.themes) {
      theme.descriptor.active = theme === active;
      theme.descriptor.watching = false;
    }

    const shared = this.collect(active, ["styles"]);
    const app = this.collect(active, ["appStyles"]);
    const ytm = this.collect(active, ["ytmStyles"]);

    if (active) {
      const extra = [...new Set([...shared.warnings, ...app.warnings, ...ytm.warnings])];
      active.descriptor.warnings = [...(active.scan.warnings ?? []), ...extra];
      active.descriptor.watching = active.descriptor.origin === "user";
    }

    const baseTokens = this.baseFile("app.css");
    this.css = {
      app: [baseTokens, shared.css, app.css].filter(Boolean).join("\n"),
      ytm: [baseTokens, this.baseFile("ytm.css"), shared.css, ytm.css].filter(Boolean).join("\n"),
      addonWindow: [baseTokens, this.baseFile("addon-ui.css"), shared.css, app.css].filter(Boolean).join("\n")
    };
    this.tokens = parseTokens(this.css.app);

    this.watchActive(active);
    const resolved = this.activeTheme();
    this.services.onChanged(this.css, resolved);
    for (const listener of this.listeners) {
      try {
        listener(resolved);
      } catch (error) {
        this.services.log.warn("A theme listener threw", error);
      }
    }
  }

  public onChange(listener: (theme: ActiveTheme) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private watchActive(active: LoadedTheme | null): void {
    this.stopWatching();
    if (!active || active.descriptor.origin !== "user") return;

    const schedule = () => {
      if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
      this.rebuildTimer = setTimeout(() => {
        this.rebuildTimer = null;
        this.rebuild();
      }, WATCH_DEBOUNCE_MS);
    };

    try {
      this.watchers.push(fs.watch(active.scan.dir, { recursive: true }, schedule));
      return;
    } catch {
      this.services.log.warn("Recursive watch unavailable, falling back to per file watching");
    }

    const manifest = active.scan.manifest;
    const declared = [...(manifest?.styles ?? []), ...(manifest?.appStyles ?? []), ...(manifest?.ytmStyles ?? [])];
    for (const relative of declared) {
      try {
        this.watchers.push(fs.watch(path.resolve(active.scan.dir, relative), {}, schedule));
      } catch {
        this.services.log.warn("Could not watch " + relative + " for live reload");
      }
    }
  }

  private stopWatching(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  public getCss(): ThemeCss {
    return this.css;
  }

  public descriptors(): ThemeDescriptor[] {
    return this.themes.map(theme => theme.descriptor);
  }

  public activeTheme(): ActiveTheme {
    const active = this.themes.find(theme => theme.descriptor.active);
    return { id: active?.descriptor.manifest.id ?? null, name: active?.descriptor.manifest.name ?? "None", tokens: this.tokens };
  }

  public titleBarOverlay(): { color: string; symbolColor: string; height: number } {
    const active = this.themes.find(theme => theme.descriptor.active);
    const overlay = active?.descriptor.manifest.titleBarOverlay;
    if (!overlay) return DEFAULT_TITLE_BAR_OVERLAY;
    return { color: overlay.color, symbolColor: overlay.symbolColor, height: DEFAULT_TITLE_BAR_OVERLAY.height };
  }

  public setActive(id: string | null): { ok: true } | { ok: false; reason: string } {
    if (id !== null) {
      const target = this.themes.find(theme => theme.descriptor.manifest.id === id);
      if (!target) return { ok: false, reason: "that theme is not installed" };
      if (target.descriptor.state !== "ok") return { ok: false, reason: target.descriptor.error ?? "that theme cannot be applied" };
    }
    this.services.setActiveId(id);
    this.rebuild();
    this.services.log.info("Theme set to " + (id ?? "none"));
    return { ok: true };
  }

  public duplicate(id: string): { ok: true; id: string; dir: string } | { ok: false; reason: string } {
    const source = this.themes.find(theme => theme.descriptor.manifest.id === id);
    if (!source) return { ok: false, reason: "that theme is not installed" };
    const result = duplicateTheme(source.scan.dir, this.services.userThemesDir);
    if ("reason" in result) return { ok: false, reason: result.reason };
    this.refresh();
    this.setActive(result.manifest.id);
    return { ok: true, id: result.manifest.id, dir: result.dir };
  }

  public exportTo(id: string, destination: string): { ok: true } | { ok: false; reason: string } {
    const source = this.themes.find(theme => theme.descriptor.manifest.id === id);
    if (!source) return { ok: false, reason: "that theme is not installed" };
    const result = exportTheme(source.scan.dir, destination);
    if ("reason" in result) return { ok: false, reason: result.reason };
    return { ok: true };
  }

  public install(zipPath: string): { ok: true; id: string } | { ok: false; reason: string } {
    fs.mkdirSync(this.services.userThemesDir, { recursive: true });
    const result = installThemeFromZip(zipPath, this.services.userThemesDir);
    if ("reason" in result) return { ok: false, reason: result.reason };
    this.refresh();
    return { ok: true, id: result.manifest.id };
  }

  public dispose(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    this.stopWatching();
  }
}
