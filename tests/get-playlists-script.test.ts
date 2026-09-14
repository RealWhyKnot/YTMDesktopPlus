import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("src/renderer/ytmview/scripts/getplaylists.script.js", "utf8").trim();

const PLAYLISTS = [{ playlistAddToOptionRenderer: { playlistId: "PL1", title: { runs: [{ text: "Mine" }] } } }];

let playerResponse: unknown;
let dispatched: CustomEvent[];

function run(): Promise<unknown> {
  return new Function(`return (${source.replace(/;$/, "")})`)()();
}

beforeEach(() => {
  playerResponse = { videoDetails: { videoId: "abc" } };
  dispatched = [];

  const playerBar = {
    playerApi: { getPlayerResponse: () => playerResponse },
    dispatchEvent: (event: CustomEvent) => {
      dispatched.push(event);
      event.detail.returnValue.push({
        ajaxPromise: Promise.resolve({ data: { contents: [{ addToPlaylistRenderer: { playlists: PLAYLISTS } }] } })
      });
    }
  };

  vi.stubGlobal("document", { querySelector: () => playerBar });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getplaylists", () => {
  it("requests the add-to-playlist list for the loaded track", async () => {
    await expect(run()).resolves.toBe(PLAYLISTS);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].detail.args[1]).toEqual({ addToPlaylistEndpoint: { videoId: "abc" } });
  });

  it("rejects without a request while a preroll ad nulls the player response", async () => {
    playerResponse = null;
    await expect(run()).rejects.toThrow("No video loaded");
    expect(dispatched).toEqual([]);
  });

  it("rejects without a request when the player response has no videoDetails", async () => {
    playerResponse = { playabilityStatus: {} };
    await expect(run()).rejects.toThrow("No video loaded");
    expect(dispatched).toEqual([]);
  });
});
