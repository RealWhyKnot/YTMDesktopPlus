import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const RENDERER_DIR = path.resolve(__dirname, "../src/renderer");
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\([0-9\s,.]+\)/g;

const ALLOWED_FILES = new Set<string>([]);

function vueFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return vueFiles(absolute);
    return entry.isFile() && entry.name.endsWith(".vue") ? [absolute] : [];
  });
}

describe("renderer styling stays themeable", () => {
  it("has no hardcoded colours outside the token layer", () => {
    const offenders: string[] = [];

    for (const file of vueFiles(RENDERER_DIR)) {
      const relative = path.relative(RENDERER_DIR, file).split(path.sep).join("/");
      if (ALLOWED_FILES.has(relative)) continue;

      for (const [index, line] of fs.readFileSync(file, "utf8").split(/\r?\n/).entries()) {
        for (const match of line.match(COLOR_LITERAL) ?? []) {
          offenders.push(`${relative}:${index + 1} ${match}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("routes every font through a token", () => {
    const offenders: string[] = [];

    for (const file of vueFiles(RENDERER_DIR)) {
      const relative = path.relative(RENDERER_DIR, file).split(path.sep).join("/");
      for (const [index, line] of fs.readFileSync(file, "utf8").split(/\r?\n/).entries()) {
        const declaration = line.match(/font-family:\s*([^;]+);/);
        if (!declaration) continue;
        const value = declaration[1].trim();
        if (value === "inherit" || value.startsWith("var(--font-")) continue;
        offenders.push(`${relative}:${index + 1} ${value}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
