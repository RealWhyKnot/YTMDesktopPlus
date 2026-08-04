import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Every script injected into the YTM view is evaluated with executeJavaScript
// and then called by the preload, so each file has to be a bare function
// expression. A self-invoking one still runs, but the caller then invokes
// undefined and the page logs a TypeError on every injection.

const scriptDirectories = ["src/renderer/ytmview/scripts", "src/main/integrations/loudness-normalization/script"];

const scripts = scriptDirectories.flatMap(directory =>
  readdirSync(directory)
    .filter(name => name.endsWith(".js"))
    .map(name => ({ path: join(directory, name) }))
);

describe("injected scripts", () => {
  it("finds the scripts to check", () => {
    expect(scripts.length).toBeGreaterThan(0);
  });

  it.each(scripts)("$path evaluates to a callable function", ({ path }) => {
    const source = readFileSync(path, "utf8").trim().replace(/;$/, "");
    expect(typeof new Function(`return (${source})`)()).toBe("function");
  });
});
