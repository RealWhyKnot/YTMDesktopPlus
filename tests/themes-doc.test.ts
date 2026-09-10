import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { parseTokens } from "../src/main/themes/manager";
import { BASE_LAYER_FOLDER } from "../src/main/themes/loader";

const BASE_DIR = path.resolve(__dirname, "../src/themes", BASE_LAYER_FOLDER);
const doc = fs.readFileSync(path.resolve(__dirname, "../docs/themes.md"), "utf8");

const documented = new Set((doc.match(/`--[a-zA-Z0-9-]+`/g) ?? []).map(match => match.slice(1, -1)));

const REFERENCED_TOKEN = /var\(\s*(--[a-zA-Z0-9-]+)/g;

function baseVocabulary(files: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const file of files) {
    const css = fs.readFileSync(path.join(BASE_DIR, file), "utf8");
    for (const token of Object.keys(parseTokens(css))) tokens.add(token);
    for (const match of css.matchAll(REFERENCED_TOKEN)) tokens.add(match[1]);
  }
  return tokens;
}

const vocabulary = baseVocabulary(["app.css", "ytm.css"]);

describe("themes documentation", () => {
  it("documents every token the base layer defines", () => {
    const missing = [...vocabulary].filter(token => !documented.has(token));
    expect(missing).toEqual([]);
  });

  it("does not document tokens the base layer no longer defines", () => {
    const stale = [...documented].filter(token => !vocabulary.has(token));
    expect(stale).toEqual([]);
  });

  it("describes every manifest field the validator accepts", () => {
    for (const field of [
      "id",
      "name",
      "version",
      "author",
      "description",
      "homepage",
      "apiVersion",
      "minAppVersion",
      "styles",
      "appStyles",
      "ytmStyles",
      "titleBarOverlay",
      "preview"
    ]) {
      expect(doc, `${field} is missing from docs/themes.md`).toContain(`\`${field}\``);
    }
  });

  it("states the no network rule", () => {
    expect(doc).toContain("@import");
    expect(doc).toMatch(/makes no network requests/);
  });

  it("points addon authors at the addon docs instead", () => {
    expect(doc).toContain("addons.md");
    expect(doc).toContain("ytmScripts");
  });
});
