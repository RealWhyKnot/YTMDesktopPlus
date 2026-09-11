import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseTokens } from "../src/main/themes/manager";
import { BASE_LAYER_FOLDER } from "../src/main/themes/loader";

const BUNDLED_DIR = path.resolve(__dirname, "../src/themes");
const BASE_DIR = path.join(BUNDLED_DIR, BASE_LAYER_FOLDER);

const THEMES = ["cassette", "cathode", "daylight", "drift", "ember", "graphite", "millennium", "neon-drive"];

const PAIRS: Array<[string, string, number]> = [
  ["--ytmd-text", "--ytmd-bg", 4.5],
  ["--ytmd-text", "--ytmd-surface", 4.5],
  ["--ytmd-text", "--ytmd-elevated", 4.5],
  ["--ytmd-text-muted", "--ytmd-bg", 4.5],
  ["--ytmd-text-muted", "--ytmd-surface", 4.5],
  ["--ytmd-text-faint", "--ytmd-bg", 3],
  ["--ytmd-icon", "--ytmd-bg", 3],
  ["--ytmd-icon", "--ytmd-surface", 3],
  ["--ytmd-icon-muted", "--ytmd-bg", 3],
  ["--ytmd-accent", "--ytmd-bg", 3],
  ["--ytmd-on-accent", "--ytmd-accent", 3],
  ["--text", "--bg", 4.5],
  ["--text", "--bg-raised", 4.5],
  ["--text", "--bg-control", 4.5],
  ["--text-muted", "--bg", 4.5],
  ["--text-faint", "--bg", 3]
];

function readTokens(file: string): Record<string, string> {
  return parseTokens(fs.readFileSync(file, "utf8"));
}

function resolve(tokens: Record<string, string>, name: string, depth = 0): string | null {
  const raw = tokens[name];
  if (raw === undefined || depth > 8) return null;
  const value = raw.trim();
  if (!value.startsWith("var(")) return value;
  const inner = value.slice(4, value.lastIndexOf(")"));
  const target = inner.split(",")[0].trim();
  const fallback = inner.slice(target.length + 1).trim();
  return resolve(tokens, target, depth + 1) ?? (fallback.length > 0 ? fallback : null);
}

function channels(value: string): [number, number, number] | null {
  const hex = value.trim();
  if (hex.startsWith("#")) {
    const digits = hex.slice(1);
    const full = digits.length === 3 ? digits.replace(/./g, d => d + d) : digits;
    if (full.length !== 6) return null;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  if (hex.startsWith("rgb")) {
    const parts = hex
      .slice(hex.indexOf("(") + 1)
      .split(",")
      .map(part => Number.parseFloat(part));
    if (parts.length < 3 || parts.some(part => Number.isNaN(part))) return null;
    return [parts[0], parts[1], parts[2]];
  }
  return null;
}

function luminance(rgb: [number, number, number]): number {
  const linear = rgb.map(channel => {
    const ratio = channel / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground: string, background: string): number | null {
  const a = channels(foreground);
  const b = channels(background);
  if (!a || !b) return null;
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function paletteFor(theme: string | null): Record<string, string> {
  const tokens = {
    ...readTokens(path.join(BASE_DIR, "app.css")),
    ...readTokens(path.join(BASE_DIR, "ytm-tokens.css"))
  };
  if (theme === null) return tokens;
  const themeCss = path.join(BUNDLED_DIR, theme, "theme.css");
  return { ...tokens, ...readTokens(themeCss) };
}

function separation(first: string, second: string): number | null {
  const a = channels(first);
  const b = channels(second);
  if (!a || !b) return null;
  return Math.sqrt(a.reduce((total, value, index) => total + (value - b[index]) ** 2, 0));
}

describe("theme accent and danger stay apart", () => {
  for (const theme of [null, ...THEMES]) {
    const label = theme ?? "base defaults";

    it(`${label} draws a boost overflow you can see`, () => {
      const palette = paletteFor(theme);
      const accent = resolve(palette, "--ytmd-accent");
      const danger = resolve(palette, "--ytmd-danger");
      expect(accent, `${label} defines --ytmd-accent`).not.toBeNull();
      expect(danger, `${label} defines --ytmd-danger`).not.toBeNull();

      const apart = separation(accent as string, danger as string);
      expect(apart, `${label} accent ${accent} and danger ${danger} resolve to colours`).not.toBeNull();
      expect(Math.round(apart as number), `${label} accent ${accent} is too close to danger ${danger}`).toBeGreaterThanOrEqual(80);
    });
  }
});

describe("theme contrast", () => {
  for (const theme of [null, ...THEMES]) {
    const label = theme ?? "base defaults";

    it(`keeps ${label} legible`, () => {
      const palette = paletteFor(theme);
      const failures: string[] = [];

      for (const [foreground, background, minimum] of PAIRS) {
        const front = resolve(palette, foreground);
        const back = resolve(palette, background);
        expect(front, `${label} defines ${foreground}`).not.toBeNull();
        expect(back, `${label} defines ${background}`).not.toBeNull();

        const ratio = contrast(front as string, back as string);
        expect(ratio, `${label} ${foreground} on ${background} is a resolvable colour`).not.toBeNull();
        if ((ratio as number) < minimum) {
          failures.push(`${foreground} on ${background} = ${(ratio as number).toFixed(2)}:1 (needs ${minimum}:1)`);
        }
      }

      expect(failures).toEqual([]);
    });
  }
});
