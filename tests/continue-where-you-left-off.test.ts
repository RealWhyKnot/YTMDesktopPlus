import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_BAR_SELECTOR } from "../src/shared/hook-probes";

const preload = readFileSync("src/renderer/ytmview/preload.ts", "utf8");
const moduleStart = preload.indexOf(`optionalModule("continue-where-you-left-off"`);
const elseBranch = preload.indexOf("} else {", moduleStart);
const scriptStart = preload.indexOf("executeJavaScript(`", elseBranch) + "executeJavaScript(`".length;
const source = preload.slice(scriptStart, preload.indexOf("`)", scriptStart)).replaceAll("${PLAYER_BAR_SELECTOR}", PLAYER_BAR_SELECTOR);

let playerResponse: unknown;
let sent: unknown[][];
let selectors: string[];

beforeEach(() => {
  sent = [];
  selectors = [];
  vi.stubGlobal("window", { ytmd: { sendVideoData: (...args: unknown[]) => sent.push(args) } });
  vi.stubGlobal("document", {
    querySelector: (selector: string) => {
      selectors.push(selector);
      return { playerApi: { getPlayerResponse: () => playerResponse, getPlaylistId: () => "RDAMVM-h8RVHpc0Yc" } };
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const run = () => (new Function(`return (${source});`)() as () => void)();

describe("continue-where-you-left-off on a watch page", () => {
  it("found the page script inside the module's else branch", () => {
    expect(moduleStart).toBeGreaterThan(-1);
    expect(elseBranch).toBeGreaterThan(moduleStart);
    expect(source).toContain("sendVideoData");
  });

  it("sends the current video details and playlist", () => {
    playerResponse = { videoDetails: { videoId: "-h8RVHpc0Yc" } };
    run();
    expect(sent).toEqual([[{ videoId: "-h8RVHpc0Yc" }, "RDAMVM-h8RVHpc0Yc"]]);
    expect(selectors.every(selector => selector === PLAYER_BAR_SELECTOR)).toBe(true);
  });

  it("sends nothing while a preroll ad leaves the player response null", () => {
    playerResponse = null;
    expect(run).not.toThrow();
    expect(sent).toEqual([]);
  });

  it("sends nothing when the response has no video details", () => {
    playerResponse = {};
    run();
    expect(sent).toEqual([]);
  });
});
