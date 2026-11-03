import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPageScript, evaluatePageScript } from "./helpers/page-script";
import { buildAddonTemplate, TEMPLATE_OUTPUT } from "../tools/build-addon-template.ts";
import { isRecord } from "../src/shared/unknown";

await buildAddonTemplate();

const integrationScriptDirectories = readdirSync("src/main/integrations", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join("src/main/integrations", entry.name, "script"))
  .filter((directory) => existsSync(directory));

const bundledAddonScriptDirectories = readdirSync("src/addons/bundled", { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join("src/addons/bundled", entry.name, "scripts"))
  .filter((directory) => existsSync(directory));

const scriptDirectories = ["src/renderer/ytmview/scripts", "src/main/addons/scripts", ...integrationScriptDirectories, ...bundledAddonScriptDirectories];

const manifest: unknown = JSON.parse(readFileSync(join(TEMPLATE_OUTPUT, "manifest.json"), "utf8"));
if (!isRecord(manifest) || !Array.isArray(manifest.ytmScripts)) throw new Error("The addon template has no page scripts");
const scriptNames: unknown[] = manifest.ytmScripts;
const exampleScripts = scriptNames.map((script) => {
  if (typeof script !== "string") throw new Error("The addon template has an invalid script path");
  return { path: join(TEMPLATE_OUTPUT, script) };
});

const scripts = [
  ...scriptDirectories.flatMap((directory) =>
    readdirSync(directory)
      .filter((name) => /\.script\.(js|ts)$/.test(name))
      .map((name) => ({ path: join(directory, name) }))
  ),
  ...exampleScripts,
];

describe("injected scripts", () => {
  it("finds the scripts to check", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)("$path evaluates to a callable function", async ({ path }) => {
    const source = (path.endsWith(".ts") ? await readPageScript(path) : readFileSync(path, "utf8").trim()).replace(/;$/, "");
    expect(typeof evaluatePageScript(source)).toBe("function");
  });
});
