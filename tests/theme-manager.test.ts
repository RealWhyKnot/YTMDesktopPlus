import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_TITLE_BAR_OVERLAY, parseTokens, ThemeManager, type ThemeManagerServices } from "../src/main/themes/manager";
import { makeTempDir } from "./helpers/temp-dir";

const tempDir = () => makeTempDir("ytmd-theme-manager-");

function writeBase(dir: string): void {
  const base = path.join(dir, "_base");
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(path.join(base, "app.css"), ":root{--bg:#000000;--accent:#f44336;--bg-control:#212121}");
  fs.writeFileSync(path.join(base, "ytm.css"), ":root{--ytmd-bg:var(--bg)}\nytmusic-app{background:var(--ytmd-bg)}");
  fs.writeFileSync(path.join(base, "addon-ui.css"), ".ytmd-button{background:var(--bg-control)}");
}

function writeTheme(dir: string, id: string, extra: Record<string, unknown> = {}, css = ":root{--bg:#ffffff;--accent:#c0392b}"): void {
  const themeDir = path.join(dir, id);
  fs.mkdirSync(themeDir, { recursive: true });
  fs.writeFileSync(
    path.join(themeDir, "theme.json"),
    JSON.stringify({ id, name: id, version: "1.0.0", author: "a", description: "d", styles: ["theme.css"], ...extra })
  );
  fs.writeFileSync(path.join(themeDir, "theme.css"), css);
}

function build(overrides: Partial<ThemeManagerServices> = {}) {
  const bundledThemesDir = tempDir();
  const userThemesDir = tempDir();
  writeBase(bundledThemesDir);
  let active: string | null = null;
  const onChanged = vi.fn();

  const manager = new ThemeManager({
    bundledThemesDir,
    userThemesDir,
    appVersion: "2026.910.0",
    getActiveId: () => active,
    setActiveId: id => {
      active = id;
    },
    onChanged,
    log: { info: vi.fn(), warn: vi.fn() },
    ...overrides
  });

  return { manager, bundledThemesDir, userThemesDir, onChanged };
}

describe("parseTokens", () => {
  it("reads every declaration from every root block", () => {
    expect(parseTokens(":root{--a:1px;--b:red}\n:root{--c:  blue  ;}")).toEqual({ "--a": "1px", "--b": "red", "--c": "blue" });
  });

  it("ignores declarations outside a root block", () => {
    expect(parseTokens(".card{--a:1px}")).toEqual({});
  });
});

describe("ThemeManager", () => {
  it("composes base then theme so the theme wins", () => {
    const { manager, bundledThemesDir } = build();
    writeTheme(bundledThemesDir, "light");
    manager.refresh();
    manager.setActive("light");

    const app = manager.getCss().app;
    expect(app.indexOf("#000000")).toBeLessThan(app.indexOf("#ffffff"));
    expect(manager.activeTheme().tokens["--bg"]).toBe("#ffffff");
    manager.dispose();
  });

  it("puts the ytm base only on the ytm surface", () => {
    const { manager, bundledThemesDir } = build();
    writeTheme(bundledThemesDir, "light");
    manager.refresh();
    manager.setActive("light");

    expect(manager.getCss().ytm).toContain("ytmusic-app");
    expect(manager.getCss().app).not.toContain("ytmusic-app");
    expect(manager.getCss().addonWindow).toContain(".ytmd-button");
    manager.dispose();
  });

  it("keeps appStyles off the music page and ytmStyles off the app", () => {
    const { manager, bundledThemesDir } = build();
    const dir = path.join(bundledThemesDir, "split");
    writeTheme(bundledThemesDir, "split", { appStyles: ["app.css"], ytmStyles: ["ytm.css"] });
    fs.writeFileSync(path.join(dir, "app.css"), ".titlebar{color:red}");
    fs.writeFileSync(path.join(dir, "ytm.css"), "ytmusic-player-bar{color:blue}");

    manager.refresh();
    manager.setActive("split");

    expect(manager.getCss().app).toContain(".titlebar");
    expect(manager.getCss().app).not.toContain("ytmusic-player-bar");
    expect(manager.getCss().ytm).toContain("ytmusic-player-bar");
    manager.dispose();
  });

  it("refuses to activate a theme that is not installed", () => {
    const { manager } = build();
    manager.refresh();

    const result = manager.setActive("ghost");
    expect(result).toEqual({ ok: false, reason: "that theme is not installed" });
    expect(manager.activeTheme().id).toBeNull();
    manager.dispose();
  });

  it("refuses to activate an incompatible theme", () => {
    const { manager, bundledThemesDir } = build();
    writeTheme(bundledThemesDir, "future", { apiVersion: 99 });
    manager.refresh();

    expect(manager.setActive("future")).toEqual({ ok: false, reason: "theme targets a newer theme API than this app serves" });
    manager.dispose();
  });

  it("marks a theme needing a newer app as incompatible", () => {
    const { manager, bundledThemesDir } = build();
    writeTheme(bundledThemesDir, "newer", { minAppVersion: "2099.1.1" });
    manager.refresh();

    const descriptor = manager.descriptors().find(entry => entry.manifest.id === "newer");
    expect(descriptor?.state).toBe("incompatible");
    manager.dispose();
  });

  it("keeps the bundled theme when a user theme claims the same id", () => {
    const { manager, bundledThemesDir, userThemesDir } = build();
    writeTheme(bundledThemesDir, "clash");
    writeTheme(userThemesDir, "clash");
    manager.refresh();

    const entries = manager.descriptors().filter(entry => entry.manifest.id === "clash");
    expect(entries).toHaveLength(2);
    expect(entries[0].origin).toBe("bundled");
    expect(entries[0].state).toBe("ok");
    expect(entries[1].state).toBe("error");
    expect(entries[1].error).toContain("id conflicts");
    manager.dispose();
  });

  it("falls back to the stock title bar overlay and uses the theme's when it has one", () => {
    const { manager, bundledThemesDir } = build();
    writeTheme(bundledThemesDir, "plain");
    writeTheme(bundledThemesDir, "fancy", { titleBarOverlay: { color: "#123456", symbolColor: "#abcdef" } });
    manager.refresh();

    manager.setActive("plain");
    expect(manager.titleBarOverlay()).toEqual(DEFAULT_TITLE_BAR_OVERLAY);

    manager.setActive("fancy");
    expect(manager.titleBarOverlay()).toEqual({ color: "#123456", symbolColor: "#abcdef", height: DEFAULT_TITLE_BAR_OVERLAY.height });
    manager.dispose();
  });

  it("only watches a user theme, never a bundled one", () => {
    const { manager, bundledThemesDir, userThemesDir } = build();
    writeTheme(bundledThemesDir, "stock");
    writeTheme(userThemesDir, "mine");
    manager.refresh();

    manager.setActive("stock");
    expect(manager.descriptors().find(entry => entry.manifest.id === "stock")?.watching).toBe(false);

    manager.setActive("mine");
    expect(manager.descriptors().find(entry => entry.manifest.id === "mine")?.watching).toBe(true);
    manager.dispose();
  });

  it("surfaces a stripped remote url on the active theme's card", () => {
    const { manager, userThemesDir } = build();
    writeTheme(userThemesDir, "leaky", {}, ":root{--bg:#fff}\nbody{background:url(https://evil.example/p.png)}");
    manager.refresh();
    manager.setActive("leaky");

    const descriptor = manager.descriptors().find(entry => entry.manifest.id === "leaky");
    expect(descriptor?.warnings.join(" ")).toContain("remote url was removed");
    expect(manager.getCss().app).not.toContain("evil.example");
    manager.dispose();
  });

  it("notifies listeners when the theme changes and stops after unsubscribe", () => {
    const { manager, bundledThemesDir } = build();
    writeTheme(bundledThemesDir, "light");
    manager.refresh();

    const listener = vi.fn();
    const unsubscribe = manager.onChange(listener);
    manager.setActive("light");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].id).toBe("light");

    unsubscribe();
    manager.setActive(null);
    expect(listener).toHaveBeenCalledTimes(1);
    manager.dispose();
  });

  it("applies the copy it just made, so editing starts on screen", () => {
    const { manager, bundledThemesDir } = build();
    writeTheme(bundledThemesDir, "light");
    manager.refresh();

    const result = manager.duplicate("light");

    expect("id" in result && result.id).toBe("light-copy");
    expect(manager.activeTheme().id).toBe("light-copy");
    const copy = manager.descriptors().find(entry => entry.manifest.id === "light-copy");
    expect(copy?.origin).toBe("user");
    expect(copy?.watching).toBe(true);
    manager.dispose();
  });

  it("builds a swatch from the theme's own tokens, not the active one", () => {
    const { manager, bundledThemesDir } = build();
    writeTheme(bundledThemesDir, "light");
    manager.refresh();

    const descriptor = manager.descriptors().find(entry => entry.manifest.id === "light");
    expect(descriptor?.swatch[0]).toBe("#ffffff");
    expect(descriptor?.swatch[1]).toBe("#212121");
    expect(descriptor?.swatch[2]).toBe("#c0392b");
    manager.dispose();
  });
});
