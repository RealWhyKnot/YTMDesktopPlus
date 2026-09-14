import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseTokens } from "../src/main/themes/manager";
import { BASE_LAYER_FOLDER } from "../src/main/themes/loader";

const BUNDLED_DIR = path.resolve(__dirname, "../src/themes");
const WINDOWS_DIR = path.resolve(__dirname, "../src/renderer/windows");
const WINDOW_PAGES = ["main", "settings", "room", "authorize-companion"];

describe("theme framework", () => {
  it.each(WINDOW_PAGES)("lets the theme drive color-scheme in the %s window", name => {
    const html = fs.readFileSync(path.join(WINDOWS_DIR, name, "index.html"), "utf8");

    expect(html).toContain("color-scheme: var(--ytmd-scheme, dark)");
    expect(html).not.toMatch(/color-scheme:\s*dark\s*;/);
  });

  it("keeps --ytmd-scheme in shared styles so app windows follow it", () => {
    for (const entry of fs.readdirSync(BUNDLED_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === BASE_LAYER_FOLDER) continue;
      const dir = path.join(BUNDLED_DIR, entry.name);
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "theme.json"), "utf8"));

      for (const field of ["appStyles", "ytmStyles"] as const) {
        for (const relative of manifest[field] ?? []) {
          const tokens = parseTokens(fs.readFileSync(path.join(dir, relative), "utf8"));
          expect(Object.keys(tokens), `${entry.name}/${relative} declares --ytmd-scheme outside styles`).not.toContain("--ytmd-scheme");
        }
      }
    }
  });

  it("zeroes every motion duration under reduced motion", () => {
    const css = fs.readFileSync(path.join(BUNDLED_DIR, BASE_LAYER_FOLDER, "app.css"), "utf8");
    const mediaStart = css.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaStart).toBeGreaterThan(-1);

    const base = parseTokens(css.slice(0, mediaStart));
    const reduced = parseTokens(css.slice(mediaStart));
    const durations = Object.entries(base).filter(([token, value]) => token.startsWith("--motion-") && /^\d+m?s$/.test(value));

    expect(durations.length).toBeGreaterThan(0);
    for (const [token] of durations) {
      expect(reduced[token], `${token} is not zeroed under reduced motion`).toBe("0s");
    }
  });
});
