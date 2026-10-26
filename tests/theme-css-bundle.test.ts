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

  it.each([
    ["upper case url", "a{background:URL(https://evil.example/p)}"],
    ["mixed case url", "a{background:uRl(https://evil.example/p)}"],
    ["quoted upper case url", 'a{background:URL("https://evil.example/p")}'],
    ["escaped url name", "a{background:\\75rl(https://evil.example/p)}"],
    ["escaped url name with a space", "a{background:\\000075 rl(https://evil.example/p)}"],
    ["escaped url name, quoted", 'a{background:\\55 RL("https://evil.example/p")}'],
    ["escaped characters in the address", "a{background:url(\\68ttps://evil.example/p)}"],
    ["escaped characters in a quoted address", 'a{background:url("htt\\70s://evil.example/p")}'],
    ["a comment before the closing paren", 'a{background:url("https://evil.example/p"/**/)}'],
    ["a comment before the string", 'a{background:url(/**/"https://evil.example/p")}'],
    ["a tab inside the scheme", 'a{background:url("ht\\9tps://evil.example/p")}'],
    ["leading spaces in a quoted address", 'a{background:url("  https://evil.example/p")}'],
    ["an upper case scheme", "a{background:url(HTTPS://evil.example/p)}"],
    ["a backslash protocol relative address", 'a{background:url("\\\\\\\\evil.example/p")}'],
    ["image-set", 'a{background:image-set("https://evil.example/p" 1x)}'],
    ["image-set with type()", 'a{background:image-set("https://evil.example/p" type("image/png") 1x)}'],
    ["upper case image-set", 'a{background:IMAGE-SET("https://evil.example/p" 1x)}'],
    ["-webkit-image-set", 'a{background:-webkit-image-set("https://evil.example/p" 1x)}'],
    ["escaped image-set", 'a{background:\\69mage-set("https://evil.example/p" 1x)}'],
    ["image-set with a comment", 'a{background:image-set(/* x */"https://evil.example/p" 1x)}'],
    ["image-set with url()", "a{background:image-set(url(https://evil.example/p) 1x)}"],
    ["image()", 'a{background:image("https://evil.example/p")}'],
    ["src()", '@font-face{font-family:X;src:src("https://evil.example/p")}'],
    ["font-face src url", "@font-face{font-family:X;src:url(https://evil.example/p) format('woff2')}"],
    ["a custom property url", ":root{--img:url(https://evil.example/p)}"],
    ["a custom property image-set", ':root{--img:image-set("https://evil.example/p" 1x)}'],
    ["an unterminated url at the end", "a{background:url(https://evil.example/p"],
    ["javascript scheme", 'a{background:url("javascript:alert(1)")}'],
    ["file scheme", "a{background:url(file:///C:/evil.example/p)}"]
  ])("strips a remote fetch written as %s", (_label, css) => {
    const result = bundleThemeCss(css, tempDir());
    expect(result.css).not.toMatch(/evil\.example|javascript|file:/i);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it.each([
    ["upper case", '@IMPORT "https://evil.example/x.css";a{color:red}'],
    ["no space before the string", '@import"https://evil.example/x.css";a{color:red}'],
    ["escaped name", '@\\69mport "https://evil.example/x.css";a{color:red}'],
    ["escaped upper case name", "@\\49 MPORT url(https://evil.example/x.css);a{color:red}"],
    ["layer and supports", '@import url("https://evil.example/x.css") layer(base) supports(display:grid);a{color:red}'],
    ["a comment inside", '@import /* hi */ "https://evil.example/x.css" /* there */;a{color:red}'],
    ["a block", '@import "https://evil.example/x.css" { b{color:blue} } a{color:red}']
  ])("strips @import written in %s", (_label, css) => {
    const result = bundleThemeCss(css, tempDir());
    expect(result.css).not.toContain("evil.example");
    expect(result.css).toContain("a{color:red}");
    expect(result.warnings.join(" ")).toContain("@import was removed");
  });

  it("drops a whole image-set built from a custom property", () => {
    const result = bundleThemeCss(':root{--x:"https://evil.example/p"}a{background:image-set(var(--x) 1x)}', tempDir());
    expect(result.css).toContain("background:none");
    expect(result.warnings.join(" ")).toContain("var()");
  });

  it("drops a url function built from a custom property", () => {
    const result = bundleThemeCss("a{background:src(var(--x))}", tempDir());
    expect(result.css).toContain("background:none");
  });

  it("inlines local images inside image-set and keeps the rest of it", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.png"), Buffer.from([0]));
    const result = bundleThemeCss('a{background:image-set("a.png" type("image/png") 1x, url(a.png) 2x)}', dir);
    expect(result.css).toBe('a{background:image-set("data:image/png;base64,AA==" type("image/png") 1x, url("data:image/png;base64,AA==") 2x)}\n');
    expect(result.warnings).toEqual([]);
  });

  it("inlines a local url written with escapes and mixed case", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "a.png"), Buffer.from([0]));
    const result = bundleThemeCss("a{background:\\55 Rl(\\61 .png)}", dir);
    expect(result.css).toBe('a{background:url("data:image/png;base64,AA==")}\n');
  });

  it("keeps fragment and data urls in any case", () => {
    const css = 'a{filter:url(#glow);mask:URL("DATA:image/svg+xml,<svg></svg>")}';
    expect(bundleThemeCss(css, tempDir()).css).toBe(`${css}\n`);
  });

  it("leaves urls inside comments and strings alone", () => {
    const css = '/* url(https://evil.example/p) */a::after{content:"url(https://example.invalid)"}';
    const result = bundleThemeCss(css, tempDir());
    expect(result.css).toBe(`${css}\n`);
    expect(result.warnings).toEqual([]);
  });

  it("does not mistake other functions or dimensions for url", () => {
    const css = "a{width:calc(1px + 2px);b:foourl(x);c:1url(x)}";
    expect(bundleThemeCss(css, tempDir()).css).toBe(`${css}\n`);
  });

  it("closes what a file leaves open so the next stylesheet cannot finish it", () => {
    const parts = [bundleThemeCss("a{background:image-set(", tempDir()).css, bundleThemeCss('"https://evil.example/p" 1x)}', tempDir()).css];
    expect(parts.join("\n")).not.toMatch(/image-set\(\)?"https/);

    const escape = bundleThemeCss("\\75", tempDir()).css + "\n" + bundleThemeCss("rl(https://evil.example/p)}", tempDir()).css;
    expect(bundleThemeCss(escape, tempDir()).warnings).toEqual([]);

    const comment = bundleThemeCss("a{color:red} /* open", tempDir()).css;
    expect(comment.trimEnd().endsWith("*/")).toBe(true);
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
