import fs from "fs";
import { describe, expect, it } from "vitest";
import { generateAddonDts, OUTPUT_PATH, SDK_SOURCE_PATH } from "../tools/generate-addon-dts.ts";

const generated = await generateAddonDts();

describe("addon sdk declarations", () => {
  it("sdk.ts stands alone with no imports", () => {
    const source = fs.readFileSync(SDK_SOURCE_PATH, "utf8");
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\bfrom\s+"/);
  });

  it("committed ytmd-addon.d.ts matches a fresh emit (run yarn sdk:dts after changing sdk.ts)", () => {
    const committed = fs.readFileSync(OUTPUT_PATH);
    expect(committed).toEqual(Buffer.from(generated, "utf8"));
  });

  it("the emitted declarations carry the surface and no imports", () => {
    expect(generated).toContain("export declare const VideoState");
    expect(generated).toContain("export type AddonContext");
    expect(generated).not.toMatch(/^\s*import\b/m);
  });
});
