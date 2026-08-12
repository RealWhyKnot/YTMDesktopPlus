import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every script injected into the YTM view is evaluated with executeJavaScript
// and then called by the preload, so each file has to be a bare function
// expression. A self-invoking one still runs, but the caller then invokes
// undefined and the page logs a TypeError on every injection.

// Every integration that ships page scripts keeps them in a script/ directory,
// and bundled addons keep theirs in scripts/, so discover them rather than
// listing them and losing coverage on the next one.
const integrationScriptDirectories = readdirSync("src/main/integrations", { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => join("src/main/integrations", entry.name, "script"))
  .filter(directory => existsSync(directory));

const bundledAddonScriptDirectories = readdirSync("src/addons/bundled", { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => join("src/addons/bundled", entry.name, "scripts"))
  .filter(directory => existsSync(directory));

const scriptDirectories = ["src/renderer/ytmview/scripts", "src/main/addons/scripts", ...integrationScriptDirectories, ...bundledAddonScriptDirectories];

// Example addons declare their page scripts in manifest.json; hold them to
// the same bare-function rule so copied templates start out correct.
const exampleScripts = readdirSync("examples", { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .flatMap(entry => {
    const manifest = JSON.parse(readFileSync(join("examples", entry.name, "manifest.json"), "utf8")) as { ytmScripts?: string[] };
    return (manifest.ytmScripts ?? []).map(script => ({ path: join("examples", entry.name, script) }));
  });

const scripts = [
  ...scriptDirectories.flatMap(directory =>
    readdirSync(directory)
      .filter(name => name.endsWith(".js"))
      .map(name => ({ path: join(directory, name) }))
  ),
  ...exampleScripts
];

describe("injected scripts", () => {
  it("finds the scripts to check", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)("$path evaluates to a callable function", ({ path }) => {
    const source = readFileSync(path, "utf8").trim().replace(/;$/, "");
    expect(typeof new Function(`return (${source})`)()).toBe("function");
  });
});
