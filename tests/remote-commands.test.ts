import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
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
