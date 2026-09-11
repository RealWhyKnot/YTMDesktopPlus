import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseTokens, ThemeManager } from "../src/main/themes/manager";
import { BASE_LAYER_FOLDER, scanThemes } from "../src/main/themes/loader";
import { makeTempDir } from "./helpers/temp-dir";

const BUNDLED_DIR = path.resolve(__dirname, "../src/themes");
const BASE_DIR = path.join(BUNDLED_DIR, BASE_LAYER_FOLDER);

const EXPECTED_THEMES = ["cassette", "cathode", "daylight", "drift", "ember", "graphite", "millennium", "neon-drive"];

const REFERENCED_TOKEN = /var\(\s*(--[a-zA-Z0-9-]+)/g;

const baseVocabulary = () => {
  const tokens = new Set<string>();
  for (const file of ["app.css", "ytm-tokens.css"]) {
    const css = fs.readFileSync(path.join(BASE_DIR, file), "utf8");
    for (const token of Object.keys(parseTokens(css))) tokens.add(token);
    for (const match of css.matchAll(REFERENCED_TOKEN)) tokens.add(match[1]);
  }
  for (const file of ["ytm.css", "addon-ui.css"]) {
    const css = fs.readFileSync(path.join(BASE_DIR, file), "utf8");
    for (const match of css.matchAll(REFERENCED_TOKEN)) {
      if (tokens.has(match[1]) || match[1].startsWith("--ytmd-")) tokens.add(match[1]);
    }
  }
  return tokens;
};

function manager(activeId: string | null) {
  let active = activeId;
  return new ThemeManager({
    bundledThemesDir: BUNDLED_DIR,
    userThemesDir: makeTempDir("ytmd-themes-user-"),
    appVersion: "9999.1.1",
    getActiveId: () => active,
    setActiveId: id => {
      active = id;
    },
    onChanged: () => undefined,
    log: { info: () => undefined, warn: () => undefined }
  });
}

describe("bundled themes", () => {
  it("ships exactly the expected set, all valid", () => {
    const scans = scanThemes(BUNDLED_DIR, "bundled");

    expect(scans.map(scan => scan.folderName).sort()).toEqual(EXPECTED_THEMES);
    for (const scan of scans) {
      expect(scan.error, `${scan.folderName}: ${scan.error}`).toBeUndefined();
      expect(scan.manifest?.id).toBe(scan.folderName);
    }
  });

  it("never lists the base layer as a theme", () => {
    expect(scanThemes(BUNDLED_DIR, "bundled").map(scan => scan.folderName)).not.toContain(BASE_LAYER_FOLDER);
  });

  it.each(EXPECTED_THEMES)("composes %s with no warnings and no leftover references", id => {
    const themes = manager(id);
    themes.refresh();

    const descriptor = themes.descriptors().find(entry => entry.manifest.id === id);
    expect(descriptor?.state).toBe("ok");
    expect(descriptor?.warnings).toEqual([]);
    expect(descriptor?.active).toBe(true);

    const css = themes.getCss();
    expect(css.app.length).toBeGreaterThan(0);
    expect(css.ytm.length).toBeGreaterThan(0);
    for (const surface of [css.app, css.ytm, css.addonWindow]) {
      expect(surface).not.toContain('url("fonts/');
      expect(surface).not.toMatch(/https?:\/\//);
    }
    themes.dispose();
  });

  it.each(EXPECTED_THEMES)("only sets tokens the base layer defines in %s", id => {
    const known = baseVocabulary();
    const dir = path.join(BUNDLED_DIR, id);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "theme.json"), "utf8"));

    const declared: string[] = [];
    for (const field of ["styles", "appStyles", "ytmStyles"] as const) {
      for (const relative of manifest[field] ?? []) {
        declared.push(...Object.keys(parseTokens(fs.readFileSync(path.join(dir, relative), "utf8"))));
      }
    }

    expect(declared.filter(token => !known.has(token))).toEqual([]);
  });

  it("inlines a bundled font as a data URI", () => {
    const themes = manager("cathode");
    themes.refresh();

    expect(themes.getCss().app).toContain("data:font/woff2;base64,");
    expect(themes.getCss().ytm).toContain("data:font/woff2;base64,");
    themes.dispose();
  });

  it("carries a licence beside every bundled font", () => {
    for (const id of EXPECTED_THEMES) {
      const fontsDir = path.join(BUNDLED_DIR, id, "fonts");
      if (!fs.existsSync(fontsDir)) continue;
      const files = fs.readdirSync(fontsDir);
      expect(
        files.some(name => name.endsWith(".woff2")),
        `${id} has a fonts folder`
      ).toBe(true);
      expect(files, `${id} ships its font licence`).toContain("OFL.txt");
    }
  });

  it("falls back to no theme when the active id is unknown", () => {
    const themes = manager("does-not-exist");
    themes.refresh();

    expect(themes.activeTheme().id).toBeNull();
    expect(themes.getCss().app).toContain("--bg");
    themes.dispose();
  });

  for (const activeId of [null, "does-not-exist"]) {
    it(`leaves YouTube Music alone when the active theme is ${activeId ?? "none"}`, () => {
      const themes = manager(activeId);
      themes.refresh();
      const ytm = themes.getCss().ytm;

      expect(ytm).not.toContain("ytmusic-app");
      expect(ytm).not.toContain("--ytmusic-");
      expect(ytm).not.toContain("color-scheme");
      expect(ytm).toContain("--ytmd-text");
      expect(ytm).toContain("--ytmd-surface");
      themes.dispose();
    });
  }

  it("repaints YouTube Music through its own tokens when a theme is active", () => {
    const themes = manager("daylight");
    themes.refresh();
    const ytm = themes.getCss().ytm;

    expect(ytm).toContain("--ytmusic-text-primary: var(--ytmd-text)");
    expect(ytm).toContain("--ytmusic-overlay-text-secondary: var(--ytmd-text-muted)");
    expect(ytm).toContain("--ytmusic-icon-inactive: var(--ytmd-icon)");
    expect(ytm).toContain("background-color: var(--ytmd-bg) !important");
    themes.dispose();
  });
});
