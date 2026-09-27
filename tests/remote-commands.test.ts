import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYER_BAR_SELECTOR } from "../src/shared/hook-probes";
import { REMOTE_COMMAND_NAMES, validateRemoteCommand } from "../src/shared/remote-commands";

describe("validateRemoteCommand", () => {
  it.each([
    ["play", undefined],
    ["playPause", undefined],
    ["setVolume", 0],
    ["setVolume", 100],
    ["seekTo", 42.5],
    ["repeatMode", "ALL"],
    ["playQueueIndex", 3],
    ["navigate", { watchEndpoint: { videoId: "abc" } }],
    // Unknown names pass: the page-side switch ignores what it does not know.
    ["futureCommand", undefined]
  ])("accepts %s with %o", (command, value) => {
    expect(validateRemoteCommand(command as string, value)).toBeNull();
  });

  it.each([
    ["setVolume", 101],
    ["setVolume", -1],
    ["setVolume", "50"],
    ["setVolume", Number.NaN],
    ["seekTo", -1],
    ["seekTo", "10"],
    ["repeatMode", "SHUFFLE"],
    ["repeatMode", 1],
    ["playQueueIndex", 1.5],
    ["playQueueIndex", -1],
    ["navigate", {}],
    ["navigate", null]
  ])("rejects %s with %o", (command, value) => {
    expect(validateRemoteCommand(command as string, value)).not.toBeNull();
  });
});

describe("remote command vocabulary", () => {
  it("matches the player page's switch exactly", () => {
    const source = fs.readFileSync(path.resolve("src/renderer/ytmview/preload.ts"), "utf8");
    const start = source.indexOf(`ipcRenderer.on("remoteControl:execute"`);
    expect(start).toBeGreaterThan(-1);

    const rest = source.slice(start + 1);
    const nextHandler = rest.indexOf("ipcRenderer.on(");
    const body = nextHandler === -1 ? rest : rest.slice(0, nextHandler);
    const cases = [...body.matchAll(/case "([A-Za-z]+)"/g)].map(match => match[1]);

    expect(new Set(cases)).toEqual(new Set(REMOTE_COMMAND_NAMES));
  });
});

describe("next command", () => {
  const preload = fs.readFileSync(path.resolve("src/renderer/ytmview/preload.ts"), "utf8");
  const scriptStart = preload.indexOf("executeJavaScript(`", preload.indexOf(`case "next"`)) + "executeJavaScript(`".length;
  const script = preload.slice(scriptStart, preload.indexOf("`)", scriptStart)).replaceAll("${PLAYER_BAR_SELECTOR}", PLAYER_BAR_SELECTOR);

  let nextButton: { click: ReturnType<typeof vi.fn> } | null;
  let nextVideo: ReturnType<typeof vi.fn>;
  let misses: string[];

  beforeEach(() => {
    nextButton = { click: vi.fn() };
    nextVideo = vi.fn();
    misses = [];
    vi.stubGlobal("window", { ytmd: { reportContractMiss: (what: string) => misses.push(what) } });
    vi.stubGlobal("document", {
      querySelector: (selector: string) =>
        selector === PLAYER_BAR_SELECTOR ? { playerApi: { nextVideo }, querySelector: (inner: string) => (inner === ".next-button" ? nextButton : null) } : null
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const run = () => (new Function(`return (${script});`)() as () => void)();

  it("clicks the player bar's Next button instead of calling the player API", () => {
    const button = nextButton;
    run();
    expect(button?.click).toHaveBeenCalledTimes(1);
    expect(nextVideo).not.toHaveBeenCalled();
    expect(misses).toEqual([]);
  });

  it("falls back to the player API and reports the missing button", () => {
    nextButton = null;
    run();
    expect(nextVideo).toHaveBeenCalledTimes(1);
    expect(misses).toEqual([`${PLAYER_BAR_SELECTOR} .next-button`]);
  });
});
