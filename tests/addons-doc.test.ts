import fs from "fs";
import { describe, expect, it } from "vitest";
import { ADDON_SETTINGS_FIELD_TYPES } from "../src/shared/addons/sdk";
import { fakeAddonContext } from "./helpers/fake-addon-context";

// The doc is held to the real surface: a context namespace, settings field
// type or manifest field that the code grows must show up in docs/addons.md
// before this suite goes green again.
const doc = fs.readFileSync("docs/addons.md", "utf8");

describe("docs/addons.md", () => {
  it("documents every context namespace", () => {
    const { ctx } = fakeAddonContext();
    for (const key of Object.keys(ctx)) {
      expect(doc, `ctx.${key} is missing from the doc`).toContain(`ctx.${key}`);
    }
  });

  it("marks the bundled-only namespaces as such", () => {
    expect(doc).toContain("bundled addons only");
  });

  it("documents every settings field type", () => {
    for (const type of ADDON_SETTINGS_FIELD_TYPES) {
      expect(doc, `field type ${type} is missing from the doc`).toContain(`\`${type}\``);
    }
  });

  it("documents every manifest field", () => {
    const manifest = JSON.parse(fs.readFileSync("examples/addon-template/manifest.json", "utf8")) as Record<string, unknown>;
    for (const key of [...Object.keys(manifest), "minAppVersion", "defaultEnabled"]) {
      expect(doc, `manifest field ${key} is missing from the doc`).toContain(`\`${key}\``);
    }
  });

  it("points authors at the types and the template", () => {
    expect(doc).toContain("ytmd-addon.d.ts");
    expect(doc).toContain("examples/addon-template");
  });
});
