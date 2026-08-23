import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The enable script rewrites HTMLMediaElement.prototype.volume in terms of the
// descriptor it finds there. Running it a second time in one document would
// wrap its own wrapper, so the guard it carries is what makes a redundant
// injection safe.

const enableSource = readFileSync("src/main/integrations/volume-ratio/script/enable.script.js", "utf8").trim();
const disableSource = readFileSync("src/main/integrations/volume-ratio/script/disable.script.js", "utf8").trim();

const EXPONENT = 3;

let media: { volume: number };
let nativeVolume: number;

function run(source: string) {
  return new Function(`return (${source.replace(/;$/, "")})`)()();
}

beforeEach(() => {
  nativeVolume = 0;

  class HTMLMediaElement {}
  Object.defineProperty(HTMLMediaElement.prototype, "volume", {
    configurable: true,
    get: () => nativeVolume,
    set: (value: number) => {
      nativeVolume = value;
    }
  });

  const globals = globalThis as Record<string, unknown>;
  globals.window = {};
  globals.HTMLMediaElement = HTMLMediaElement;
  media = Object.create(HTMLMediaElement.prototype) as { volume: number };
});

afterEach(() => {
  for (const key of ["window", "HTMLMediaElement"]) {
    delete (globalThis as Record<string, unknown>)[key];
  }
});

describe("volume ratio enable script", () => {
  it("scales what the page sets by the exponent", () => {
    run(enableSource);

    media.volume = 0.5;

    expect(nativeVolume).toBeCloseTo(0.5 ** EXPONENT, 10);
    expect(media.volume).toBeCloseTo(0.5, 10);
  });

  it("leaves the scaling alone when it runs again in the same document", () => {
    run(enableSource);
    run(enableSource);

    media.volume = 0.5;

    expect(nativeVolume).toBeCloseTo(0.5 ** EXPONENT, 10);
  });

  it("scales again after a disable, which the guard must not block", () => {
    run(enableSource);
    run(disableSource);

    media.volume = 0.5;
    expect(nativeVolume).toBeCloseTo(0.5, 10);

    run(enableSource);
    media.volume = 0.5;
    expect(nativeVolume).toBeCloseTo(0.5 ** EXPONENT, 10);
  });
});
