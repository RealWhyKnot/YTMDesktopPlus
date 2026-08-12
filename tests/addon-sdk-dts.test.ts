import fs from "fs";
import { describe, expect, it } from "vitest";
import { generateAddonDts, OUTPUT_PATH, SDK_SOURCE_PATH } from "../tools/generate-addon-dts.mjs";

// The SDK file is the single source of truth for the addon API: the app
// compiles against it and ytmd-addon.d.ts is emitted from it. These checks
// keep it self-contained and keep the committed copy in step.
describe("addon sdk declarations", () => {
  it("sdk.ts stands alone with no imports", () => {
    const source = fs.readFileSync(SDK_SOURCE_PATH, "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bfrom\s+"/);
  });

  it("committed ytmd-addon.d.ts matches a fresh emit (run yarn sdk:dts after changing sdk.ts)", () => {
    const generated = generateAddonDts();
    const committed = fs.readFileSync(OUTPUT_PATH, "utf8").replace(/\r\n/g, "\n");
    expect(committed).toBe(generated);
  });

  it("the emitted declarations carry the surface and no imports", () => {
    const generated = generateAddonDts();
    expect(generated).toContain("export declare enum VideoState");
    expect(generated).toContain("export interface AddonContext");
    expect(generated).not.toMatch(/^\s*import\b/m);
  });
});
