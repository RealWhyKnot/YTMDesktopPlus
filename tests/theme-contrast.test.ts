import { requireValue } from "./helpers/require-value";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseTokens } from "../src/main/themes/manager";
import { BASE_LAYER_FOLDER } from "../src/main/themes/loader";
import { CONTRAST_PAIRS as PAIRS, channels, contrast, resolveToken as resolve, separation } from "../src/shared/themes/contrast";
import { BUNDLED_THEME_IDS as THEMES } from "./helpers/bundled-theme-ids";

const BUNDLED_DIR = path.resolve(__dirname, "../src/themes");
const BASE_DIR = path.join(BUNDLED_DIR, BASE_LAYER_FOLDER);

describe("RGB channel parsing", () => {
  it.each([
    ["rgb(12px, 1.5,  7 )", [12, 1.5, 7]],
    ["rgb(3beta, +.5, -0)", [3, 0.5, -0]],
    ["rgba(1e2, 2e+, 0x10, .5)", [100, 2, 0]],
    ["rgb(Infinity, -Infinity, .5)", [Infinity, -Infinity, 0.5]],
    ["rgb(, 1, 2)", null],
    ["rgb(NaN, 1, 2)", null],
    ["rgba(1, 2, 3, invalid)", null],
  ])("keeps the channel values in %s", (value, expected) => {
    expect(channels(value)).toEqual(expected);
  });
});

function readTokens(file: string): Record<string, string> {
  return parseTokens(fs.readFileSync(file, "utf8"));
}

function paletteFor(theme: string | null): Record<string, string> {
  const tokens = {
    ...readTokens(path.join(BASE_DIR, "app.css")),
    ...readTokens(path.join(BASE_DIR, "ytm-tokens.css")),
  };
  if (theme === null) return tokens;
  const themeCss = path.join(BUNDLED_DIR, theme, "theme.css");
  return { ...tokens, ...readTokens(themeCss) };
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

      const apart = separation(requireValue(accent), requireValue(danger));
      expect(apart, `${label} accent ${requireValue(accent)} and danger ${requireValue(danger)} resolve to colours`).not.toBeNull();
      expect(Math.round(requireValue(apart)), `${label} accent ${requireValue(accent)} is too close to danger ${requireValue(danger)}`).toBeGreaterThanOrEqual(
        80
      );
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

        const ratio = contrast(requireValue(front), requireValue(back));
        expect(ratio, `${label} ${foreground} on ${background} is a resolvable colour`).not.toBeNull();
        if (requireValue(ratio) < minimum) {
          failures.push(`${foreground} on ${background} = ${requireValue(ratio).toFixed(2)}:1 (needs ${minimum}:1)`);
        }
      }

      expect(failures).toEqual([]);
    });
  }
});
