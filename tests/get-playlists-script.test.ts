import { requireValue } from "./helpers/require-value";
import { readPageScript, runPageScript } from "./helpers/page-script";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = (await readPageScript("src/renderer/ytmview/scripts/getplaylists.script.ts")).trim();

const PLAYLISTS = [{ playlistAddToOptionRenderer: { playlistId: "PL1", title: { runs: [{ text: "Mine" }] } } }];

let playerResponse: unknown;
let serviceFailure: Error | undefined;
let dispatched: CustomEvent<{ args: unknown[]; returnValue: unknown[] }>[];

function run(): Promise<unknown> {
  return Promise.resolve(runPageScript(source));
}

beforeEach(() => {
  playerResponse = { videoDetails: { videoId: "abc" } };
  serviceFailure = undefined;
  dispatched = [];

  const playerBar = {
    playerApi: { getPlayerResponse: () => playerResponse },
    dispatchEvent: (event: CustomEvent<{ args: unknown[]; returnValue: unknown[] }>) => {
      dispatched.push(event);
      event.detail.returnValue.push({
        ajaxPromise:
          serviceFailure === undefined
            ? Promise.resolve({ data: { contents: [{ addToPlaylistRenderer: { playlists: PLAYLISTS } }] } })
            : Promise.reject(serviceFailure),
      });
    },
  };

  vi.stubGlobal("document", { querySelector: () => playerBar });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getplaylists", () => {
  it("reports a playlist failure with the original page error as its cause", async () => {
    serviceFailure = new Error("Page service failed");
    await expect(run()).rejects.toMatchObject({ message: "Could not load playlists", cause: serviceFailure });
  });
  it("requests the add-to-playlist list for the loaded track", async () => {
    await expect(run()).resolves.toBe(PLAYLISTS);
    expect(dispatched).toHaveLength(1);
    expect(requireValue(dispatched[0]).detail.args[1]).toEqual({ addToPlaylistEndpoint: { videoId: "abc" } });
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
