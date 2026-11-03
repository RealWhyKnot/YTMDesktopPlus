import { readPageScript, runPageScript } from "./helpers/page-script";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const [enableSource, disableSource] = await Promise.all([
  readPageScript("src/main/integrations/volume-ratio/script/enable.script.ts"),
  readPageScript("src/main/integrations/volume-ratio/script/disable.script.ts"),
]);

const EXPONENT = 3;

let media: { volume: number };
let nativeVolume: number;

function run(source: string) {
  return runPageScript(source);
}

beforeEach(() => {
  nativeVolume = 0;

  class HTMLMediaElement {
    get volume() {
      return nativeVolume;
    }
    set volume(value: number) {
      nativeVolume = value;
    }
  }

  const globals = globalThis as Record<string, unknown>;
  globals.window = {};
  globals.HTMLMediaElement = HTMLMediaElement;
  media = new HTMLMediaElement();
});

afterEach(() => {
  for (const key of ["window", "HTMLMediaElement"]) {
    Reflect.deleteProperty(globalThis, key);
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

  it("leaks no globals onto the page and stays quiet on every read", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      run(enableSource);
      media.volume = 0.5;
      expect(media.volume).toBeCloseTo(0.5, 10);
      expect(media.volume).toBeCloseTo(0.5, 10);

      expect(Object.prototype.hasOwnProperty.call(globalThis, "get")).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(globalThis, "set")).toBe(false);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      delete (globalThis as Record<string, unknown>).get;
      delete (globalThis as Record<string, unknown>).set;
    }
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
