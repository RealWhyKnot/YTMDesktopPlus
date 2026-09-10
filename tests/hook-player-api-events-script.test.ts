import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = readFileSync("src/renderer/ytmview/scripts/hookplayerapievents.script.js", "utf8").trim();

type Listener = (event: unknown) => void;

let apiListeners: Map<string, Listener>;
let storeSubscribers: Listener[];
let windowListeners: Map<string, Listener>;
let misses: [string, string | undefined][];
let storeUpdates: unknown[][];
let videoData: unknown[][];
let state: Record<string, unknown>;
let playerResponse: unknown;
let currentItem: unknown;
let likeButton: { data?: { likeStatus?: string } } | null;

const ALBUM_RUN = {
  text: "An Album",
  navigationEndpoint: {
    browseEndpoint: {
      browseId: "MPREb_album",
      browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } }
    }
  }
};

function run() {
  return new Function(`return (${source.replace(/;$/, "")})`)()();
}

function videoDataEvent() {
  apiListeners.get("onVideoDataChange")?.({ playertype: 1, type: "dataloaded" });
}

beforeEach(() => {
  apiListeners = new Map();
  storeSubscribers = [];
  windowListeners = new Map();
  misses = [];
  storeUpdates = [];
  videoData = [];
  likeButton = { data: { likeStatus: "LIKE" } };
  currentItem = { title: { runs: [{ text: "Song" }] }, thumbnail: { thumbnails: [] }, longBylineText: { runs: [ALBUM_RUN] } };
  playerResponse = { videoDetails: { videoId: "abc", title: "Raw" } };
  state = { queue: { items: [] }, likeStatus: { videos: {} }, player: { volume: 40, muted: false, adPlaying: false } };

  const playerApi = {
    addEventListener: (name: string, listener: Listener) => apiListeners.set(name, listener),
    getPlayerResponse: () => playerResponse,
    getPlaylistId: () => "PL1"
  };

  const playerBar = {
    playerApi,
    querySelector: () => likeButton,
    get currentItem() {
      return currentItem;
    }
  };

  vi.stubGlobal("document", { querySelector: () => playerBar });
  vi.stubGlobal("window", {
    __YTMD_HOOK__: { ytmStore: { getState: () => state, subscribe: (fn: Listener) => storeSubscribers.push(fn) } },
    addEventListener: (name: string, listener: Listener) => windowListeners.set(name, listener),
    ytmd: {
      reportContractMiss: (what: string, detail?: string) => misses.push([what, detail]),
      sendVideoProgress: () => {},
      sendVideoState: () => {},
      sendStoreUpdate: (...args: unknown[]) => storeUpdates.push(args),
      sendVideoData: (...args: unknown[]) => videoData.push(args),
      sendCreatePlaylistObservation: () => {},
      sendDeletePlaylistObservation: () => {}
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hookplayerapievents", () => {
  it("registers the player and store listeners", () => {
    run();
    expect([...apiListeners.keys()]).toEqual(["onVideoProgress", "onStateChange", "onVideoDataChange"]);
    expect(storeSubscribers).toHaveLength(1);
    expect(windowListeners.has("yt-action")).toBe(true);
  });

  it("sends store state with the like button status", () => {
    run();
    storeSubscribers[0]({});
    expect(storeUpdates).toEqual([[state.queue, "LIKE", 40, false, false]]);
    expect(misses).toEqual([]);
  });

  it("prefers the store like status over the button", () => {
    state.likeStatus = { videos: { abc: "DISLIKE" } };
    run();
    storeSubscribers[0]({});
    expect(storeUpdates[0][1]).toBe("DISLIKE");
  });

  it("keeps sending state when the like button element moves", () => {
    likeButton = null;
    run();
    storeSubscribers[0]({});
    expect(storeUpdates).toEqual([[state.queue, "UNKNOWN", 40, false, false]]);
    expect(misses).toEqual([["ytmusic-like-button-renderer", undefined]]);
  });

  it("reports and survives a store shape change instead of throwing at the subscriber", () => {
    state = {};
    run();
    expect(() => storeSubscribers[0]({})).not.toThrow();
    expect(storeUpdates).toEqual([]);
    expect(misses[0][0]).toBe("store-state");
  });

  it("sends video data with the album pulled out of the byline", () => {
    run();
    videoDataEvent();
    expect(videoData).toHaveLength(1);
    const [details, playlistId, album, likeStatus, hasFullMetadata] = videoData[0];
    expect((details as { title: string }).title).toBe("Song");
    expect(playlistId).toBe("PL1");
    expect(album).toEqual({ id: "MPREb_album", text: "An Album" });
    expect(likeStatus).toBe("LIKE");
    expect(hasFullMetadata).toBe(true);
  });

  it("ignores byline runs that are not album links", () => {
    currentItem = {
      title: { runs: [{ text: "Song" }] },
      longBylineText: { runs: [{ text: "Artist", navigationEndpoint: { watchEndpoint: { videoId: "x" } } }] }
    };
    run();
    videoDataEvent();
    expect(videoData[0][2]).toBeNull();
    expect(misses).toEqual([]);
  });

  it("reports a byline shape change and still sends the track", () => {
    currentItem = { title: { runs: [{ text: "Song" }] } };
    run();
    videoDataEvent();
    expect(videoData).toHaveLength(1);
    expect(videoData[0][2]).toBeNull();
    expect(misses).toEqual([["currentItem.longBylineText.runs", undefined]]);
  });

  it("stays quiet when no track is loaded yet", () => {
    playerResponse = null;
    run();
    expect(() => videoDataEvent()).not.toThrow();
    expect(videoData).toEqual([]);
    expect(misses).toEqual([]);
  });

  it("reports a player response that has lost videoDetails", () => {
    playerResponse = { playabilityStatus: {} };
    run();
    expect(() => videoDataEvent()).not.toThrow();
    expect(videoData).toEqual([]);
    expect(misses).toEqual([["videoData: getPlayerResponse().videoDetails", undefined]]);
  });

  it("sends without full metadata when there is no current item", () => {
    currentItem = null;
    run();
    videoDataEvent();
    expect(videoData[0][0]).toEqual({ videoId: "abc", title: "Raw" });
    expect(videoData[0][4]).toBe(false);
  });

  it("ignores player events for other player types and states", () => {
    run();
    apiListeners.get("onVideoDataChange")?.({ playertype: 2, type: "dataloaded" });
    apiListeners.get("onVideoDataChange")?.({ playertype: 1, type: "newdata" });
    expect(videoData).toEqual([]);
  });

  it("reports a yt-action shape change instead of throwing into the page bus", () => {
    run();
    expect(() => windowListeners.get("yt-action")?.({ detail: { actionName: "yt-service-request", args: [] } })).not.toThrow();
    expect(misses[0][0]).toBe("yt-action");
  });
});
