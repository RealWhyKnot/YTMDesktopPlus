import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildExternalDefinition, scanExternalAddons } from "../src/main/addons/external-loader";
import { fakeAddonContext, makeManifest } from "./helpers/fake-addon-context";
import type { AddonManifest } from "../src/shared/addons/sdk";
import { makeTempDir } from "./helpers/temp-dir";

// Real folders on disk, loaded through the real createRequire path.

function addonDir(id: string, files: Record<string, string>): string {
  const root = makeTempDir("ytmd-loader-test-");
  const dir = path.join(root, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

function load(dir: string, manifest: AddonManifest) {
  const definition = buildExternalDefinition(dir, manifest);
  const fixture = fakeAddonContext({ manifest });
  return { definition, fixture };
}

describe("buildExternalDefinition", () => {
  it.each([
    ["a bare function export", "module.exports = ctx => { ctx.log.info('bare'); };"],
    ["an activate export", "module.exports.activate = ctx => { ctx.log.info('named'); };"],
    ["a default.activate export", "module.exports.default = { activate: ctx => { ctx.log.info('default'); } };"]
  ])("accepts %s", async (_label, source) => {
    const manifest = makeManifest({ id: "shape", main: "index.js" });
    const dir = addonDir("shape", { "index.js": source });
    const { definition, fixture } = load(dir, manifest);

    await definition.activate(fixture.ctx);
    expect(fixture.ctx.log.info).toHaveBeenCalled();
  });

  it("rejects a main without an activate export", async () => {
    const manifest = makeManifest({ id: "empty", main: "index.js" });
    const dir = addonDir("empty", { "index.js": "module.exports = { notActivate: true };" });
    const { definition, fixture } = load(dir, manifest);

    await expect(definition.activate(fixture.ctx)).rejects.toThrow(/does not export an activate function/);
  });

  it("resolves sibling files and the addon's own node_modules", async () => {
    const manifest = makeManifest({ id: "deps", main: "index.js" });
    const dir = addonDir("deps", {
      "index.js": `const helper = require("./helper"); const dep = require("dep");
module.exports.activate = ctx => { ctx.memory.set("sum", helper.two + dep.three); };`,
      "helper.js": "module.exports.two = 2;",
      "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js" }),
      "node_modules/dep/index.js": "module.exports.three = 3;"
    });
    const { definition, fixture } = load(dir, manifest);

    await definition.activate(fixture.ctx);
    expect(fixture.ctx.memory.get("sum")).toBe(5);
  });

  it("wires styles and page scripts from the manifest", async () => {
    const manifest = makeManifest({ id: "wired", styles: ["look.css"], ytmScripts: ["scripts/tweak.script.js"] });
    const dir = addonDir("wired", {
      "look.css": "body { opacity: 1; }",
      "scripts/tweak.script.js": "(function () { return true; });"
    });
    const { definition, fixture } = load(dir, manifest);

    await definition.activate(fixture.ctx);
    expect(fixture.ctx.ytmview.watchCSSFile).toHaveBeenCalledWith(path.join(dir, "look.css"));
    expect(fixture.captured.scripts["tweak.script"]).toContain("return true");

    fixture.fireLoaded();
    expect(fixture.ctx.ytmview.runScript).toHaveBeenCalledWith("tweak.script");
  });
});

describe("scanExternalAddons", () => {
  it("carries warnings for loose manifests without failing them", () => {
    const root = makeTempDir("ytmd-scan-test-");
    const dir = path.join(root, "loose");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ ...makeManifest({ id: "loose" }), version: "v2" }));

    const scans = scanExternalAddons(root);
    expect(scans).toHaveLength(1);
    expect(scans[0].error).toBeUndefined();
    expect(scans[0].warnings?.[0]).toContain("semver");
  });
});
