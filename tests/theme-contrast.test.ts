import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseTokens } from "../src/main/themes/manager";
import { BASE_LAYER_FOLDER } from "../src/main/themes/loader";
import { CONTRAST_PAIRS as PAIRS, contrast, resolveToken as resolve, separation } from "../src/shared/themes/contrast";
import { BUNDLED_THEME_IDS as THEMES } from "./helpers/bundled-theme-ids";

const BUNDLED_DIR = path.resolve(__dirname, "../src/themes");
const BASE_DIR = path.join(BUNDLED_DIR, BASE_LAYER_FOLDER);

function readTokens(file: string): Record<string, string> {
  return parseTokens(fs.readFileSync(file, "utf8"));
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
