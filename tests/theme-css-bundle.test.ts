import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { bundleThemeCss, bundleThemeFile } from "../src/main/themes/css-bundle";
import { makeTempDir } from "./helpers/temp-dir";

const tempDir = () => makeTempDir("ytmd-theme-css-");

describe("bundleThemeCss", () => {
  it("inlines a relative font as a data URI", () => {
    const dir = tempDir();
    fs.mkdirSync(path.join(dir, "fonts"));
    fs.writeFileSync(path.join(dir, "fonts", "x.woff2"), Buffer.from([1, 2, 3, 4]));

    const result = bundleThemeCss('@font-face { font-family: X; src: url("fonts/x.woff2") format("woff2"); }', dir);

    expect(result.css).toContain("data:font/woff2;base64,AQIDBA==");
    expect(result.css).not.toContain("fonts/x.woff2");
    expect(result.warnings).toEqual([]);
  });

  it("handles quoted, single quoted and bare url tokens", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.png"), Buffer.from([0]));

    const result = bundleThemeCss("a{background:url(\"a.png\")}b{background:url('a.png')}c{background:url(a.png)}", dir);

    expect(result.css.match(/data:image\/png/g)).toHaveLength(3);
  });

  it("strips remote urls so a theme cannot phone home", () => {
    const dir = tempDir();
    const result = bundleThemeCss("a{background:url(https://evil.example/pixel.png)}", dir);

    expect(result.css).not.toContain("evil.example");
    expect(result.css).toContain("none");
    expect(result.warnings.join(" ")).toContain("remote url was removed");
  });

  it("strips protocol relative urls too", () => {
    const result = bundleThemeCss("a{background:url(//evil.example/p.png)}", tempDir());
    expect(result.css).not.toContain("evil.example");
  });

  it("strips @import", () => {
    const result = bundleThemeCss('@import url("https://evil.example/x.css");\na{color:red}', tempDir());

    expect(result.css).not.toContain("@import");
    expect(result.css).toContain("color:red");
    expect(result.warnings.join(" ")).toContain("@import was removed");
  });

  it("refuses a url escaping the theme folder", () => {
    const dir = tempDir();
    const outside = path.join(dir, "..", "secret.png");
    fs.writeFileSync(outside, Buffer.from([9]));

    const result = bundleThemeCss("a{background:url(../secret.png)}", dir);

    expect(result.css).not.toContain("data:");
    expect(result.warnings.join(" ")).toContain("must stay inside the theme folder");
  });

  it("leaves an existing data URI alone", () => {
    const css = "a{background:url(\"data:image/svg+xml;utf8,<svg xmlns='x'></svg>\")}";
    expect(bundleThemeCss(css, tempDir()).css).toContain("data:image/svg+xml");
  });

  it("reports a missing file instead of throwing", () => {
    const result = bundleThemeCss("a{background:url(nope.png)}", tempDir());
    expect(result.warnings.join(" ")).toMatch(/missing|could not be embedded/);
  });
});

describe("bundleThemeFile", () => {
  it("reads and bundles a stylesheet", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "app.css"), ":root{--bg:#fff}");
    expect(bundleThemeFile(dir, "app.css").css).toContain("--bg:#fff");
  });

  it("refuses a stylesheet path escaping the folder", () => {
    const result = bundleThemeFile(tempDir(), "../outside.css");
    expect(result.warnings.join(" ")).toContain("must stay inside the theme folder");
  });
});
