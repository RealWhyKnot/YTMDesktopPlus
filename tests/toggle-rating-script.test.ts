import { requireValue } from "./helpers/require-value";
import { readPageScript, runPageScript } from "./helpers/page-script";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = (await readPageScript("src/renderer/ytmview/scripts/togglerating.script.ts"))
  .trim()
  .replaceAll("__RATING__", "LIKE")
  .replaceAll("__OPPOSITE__", "DISLIKE");

const LIKE_ENDPOINT = { likeEndpoint: { status: "LIKE" } };
const INDIFFERENT_ENDPOINT = { likeEndpoint: { status: "INDIFFERENT" } };

let playerResponse: unknown;
let storeVideos: Record<string, string>;
let dispatched: CustomEvent<{ args: unknown[]; returnValue: unknown[] }>[];
let likeButtonReads: number;

function run() {
  return runPageScript(source);
}

beforeEach(() => {
  playerResponse = { videoDetails: { videoId: "abc" } };
  storeVideos = {};
  dispatched = [];
  likeButtonReads = 0;

  const likeButton = {
    get data() {
      likeButtonReads++;
      return { likeStatus: "INDIFFERENT", serviceEndpoints: [LIKE_ENDPOINT, INDIFFERENT_ENDPOINT] };
    },
    dispatchEvent: (event: CustomEvent<{ args: unknown[]; returnValue: unknown[] }>) => dispatched.push(event),
  };
  const playerBar = {
    playerApi: { getPlayerResponse: () => playerResponse },
    querySelector: () => likeButton,
  };

  vi.stubGlobal("document", {
    querySelector: (selector: string) => (selector === "ytmusic-like-button-renderer" ? likeButton : playerBar),
  });
  vi.stubGlobal("window", {
    __YTMD_HOOK__: { ytmStore: { getState: () => ({ likeStatus: { videos: storeVideos } }) } },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("togglerating", () => {
  it("likes an unrated track", () => {
    run();
    expect(dispatched).toHaveLength(1);
    expect(requireValue(dispatched[0]).detail.args[1]).toBe(LIKE_ENDPOINT);
  });

  it("clears a like the store already holds for the track", () => {
    storeVideos.abc = "LIKE";
    run();
    expect(requireValue(dispatched[0]).detail.args[1]).toBe(INDIFFERENT_ENDPOINT);
  });

  it("does nothing while a preroll ad nulls the player response", () => {
    playerResponse = null;
    expect(() => run()).not.toThrow();
    expect(dispatched).toEqual([]);
    expect(likeButtonReads).toBe(0);
  });

  it("does nothing when the player response has no videoDetails", () => {
    playerResponse = { playabilityStatus: {} };
    expect(() => run()).not.toThrow();
    expect(dispatched).toEqual([]);
  });
});
