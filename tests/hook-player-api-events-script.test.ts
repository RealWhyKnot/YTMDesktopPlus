import { requireValue, requireRecord } from "./helpers/require-value";
import { readPageScript, runPageScript } from "./helpers/page-script";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installQueueProjection } from "../src/shared/queue-projection";

const source = await readPageScript("src/renderer/ytmview/scripts/hookplayerapievents.script.ts");

type Listener = (event: unknown) => void;

let apiListeners: Map<string, Listener>;
let storeSubscribers: Listener[];
let windowListeners: Map<string, Listener>;
let misses: [string, string | undefined][];
let storeUpdates: unknown[][];
let queueUpdates: unknown[];
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
      browseEndpointContextSupportedConfigs: { browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ALBUM" } },
    },
  },
};

function run() {
  return runPageScript(source);
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
  queueUpdates = [];
  videoData = [];
  likeButton = { data: { likeStatus: "LIKE" } };
  currentItem = { title: { runs: [{ text: "Song" }] }, thumbnail: { thumbnails: [] }, longBylineText: { runs: [ALBUM_RUN] } };
  playerResponse = { videoDetails: { videoId: "abc", title: "Raw" } };
  state = { queue: { items: [] }, likeStatus: { videos: {} }, player: { volume: 40, muted: false, adPlaying: false } };

  const playerApi = {
    addEventListener: (name: string, listener: Listener) => apiListeners.set(name, listener),
    getPlayerResponse: () => playerResponse,
    getPlaylistId: () => "PL1",
  };

  const playerBar = {
    playerApi,
    querySelector: () => likeButton,
    get currentItem() {
      return currentItem;
    },
  };

  vi.stubGlobal("document", { querySelector: () => playerBar });
  vi.stubGlobal("window", {
    __YTMD_HOOK__: { ytmStore: { getState: () => state, subscribe: (fn: Listener) => storeSubscribers.push(fn) } },
    addEventListener: (name: string, listener: Listener) => windowListeners.set(name, listener),
    ytmd: {
      reportContractMiss: (what: string, detail?: string) => misses.push([what, detail]),
      sendVideoProgress: () => {
        return undefined;
      },
      sendVideoState: () => {
        return undefined;
      },
      sendStoreUpdate: (...args: unknown[]) => storeUpdates.push(args),
      sendQueueUpdate: (queue: unknown) => queueUpdates.push(queue),
      sendVideoData: (...args: unknown[]) => videoData.push(args),
      sendCreatePlaylistObservation: () => {
        return undefined;
      },
      sendDeletePlaylistObservation: () => {
        return undefined;
      },
    },
  });
  installQueueProjection();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("hookplayerapievents", () => {
  it("registers the player and store listeners", () => {
    run();
    expect([...apiListeners.keys()]).toEqual(["onVideoProgress", "onStateChange", "onVideoDataChange"]);
    expect(storeSubscribers).toHaveLength(1);
    expect(windowListeners.has("yt-action")).toBe(true);
  });

  it("sends the queue and the player fields as soon as it hooks in", () => {
    run();
    expect(storeUpdates).toEqual([["LIKE", 40, false, false]]);
    expect(queueUpdates).toEqual([{ items: [], automixItems: [], autoplay: false, isGenerating: false, isInfinite: false, repeatMode: "" }]);
    expect(misses).toEqual([]);
  });

  it("prefers the store like status over the button", () => {
    state.likeStatus = { videos: { abc: "DISLIKE" } };
    run();
    expect(requireValue(storeUpdates[0])[0]).toBe("DISLIKE");
  });

  it("keeps sending state when the like button element moves", () => {
    likeButton = null;
    run();
    expect(storeUpdates).toEqual([["UNKNOWN", 40, false, false]]);
    expect(misses).toEqual([["ytmusic-like-button-renderer", undefined]]);
  });

  it("reports and survives a store shape change instead of throwing at the subscriber", () => {
    state = {};
    expect(() => run()).not.toThrow();
    expect(() => requireValue(storeSubscribers[0]).call(storeSubscribers, {})).not.toThrow();
    vi.runAllTimers();
    expect(storeUpdates).toEqual([]);
    expect(requireValue(misses[0])[0]).toBe("store-state");
  });

  it("folds a burst of store dispatches into one send", () => {
    run();
    storeUpdates.length = 0;
    state = { ...state, player: { volume: 55, muted: false, adPlaying: false } };
    for (let i = 0; i < 5; i++) requireValue(storeSubscribers[0]).call(storeSubscribers, {});
    expect(storeUpdates).toEqual([]);

    vi.runAllTimers();

    expect(storeUpdates).toEqual([["LIKE", 55, false, false]]);
    expect(queueUpdates).toHaveLength(1);
  });

  it("stays quiet for dispatches that change nothing it sends", () => {
    run();
    requireValue(storeSubscribers[0]).call(storeSubscribers, {});
    vi.runAllTimers();

    expect(storeUpdates).toHaveLength(1);
    expect(queueUpdates).toHaveLength(1);
  });

  it("sends the queue again only once the store replaces it", () => {
    run();
    state = {
      ...state,
      queue: {
        items: [{ playlistPanelVideoRenderer: { videoId: "v1", title: { runs: [{ text: "One" }] }, selected: true } }],
        automixItems: [],
        repeatMode: "ALL",
      },
    };
    requireValue(storeSubscribers[0]).call(storeSubscribers, {});
    vi.runAllTimers();

    expect(storeUpdates).toHaveLength(1);
    expect(queueUpdates).toHaveLength(2);
    expect(queueUpdates[1]).toMatchObject({ items: [{ videoId: "v1", title: "One", selected: true }], repeatMode: "ALL" });
  });

  it("sends video data with the album pulled out of the byline", () => {
    run();
    videoDataEvent();
    expect(videoData).toHaveLength(1);
    const [details, playlistId, album, likeStatus, hasFullMetadata] = requireValue(videoData[0]);
    expect(requireRecord(details).title).toBe("Song");
    expect(playlistId).toBe("PL1");
    expect(album).toEqual({ id: "MPREb_album", text: "An Album" });
    expect(likeStatus).toBe("LIKE");
    expect(hasFullMetadata).toBe(true);
  });

  it("keeps the player response thumbnails when the current item has none", () => {
    const rawThumbnail = { thumbnails: [{ url: "https://example.invalid/raw.jpg", width: 120, height: 90 }] };
    playerResponse = { videoDetails: { videoId: "abc", title: "Raw", thumbnail: rawThumbnail } };

    for (const thumbnail of [undefined, null, { thumbnails: [] }, {}]) {
      currentItem = { title: { runs: [{ text: "Song" }] }, thumbnail, longBylineText: { runs: [ALBUM_RUN] } };
      run();
      videoDataEvent();
      expect(requireRecord(requireValue(videoData.at(-1))[0]).thumbnail).toEqual(rawThumbnail);
    }
  });

  it("takes the current item thumbnails when it has some", () => {
    const itemThumbnail = { thumbnails: [{ url: "https://example.invalid/big.jpg", width: 544, height: 544 }] };
    playerResponse = { videoDetails: { videoId: "abc", title: "Raw", thumbnail: { thumbnails: [] } } };
    currentItem = { title: { runs: [{ text: "Song" }] }, thumbnail: itemThumbnail, longBylineText: { runs: [ALBUM_RUN] } };
    run();
    videoDataEvent();
    expect(requireRecord(requireValue(videoData[0])[0]).thumbnail).toEqual(itemThumbnail);
  });

  it("ignores byline runs that are not album links", () => {
    currentItem = {
      title: { runs: [{ text: "Song" }] },
      longBylineText: { runs: [{ text: "Artist", navigationEndpoint: { watchEndpoint: { videoId: "x" } } }] },
    };
    run();
    videoDataEvent();
    expect(requireValue(videoData[0])[2]).toBeNull();
    expect(misses).toEqual([]);
  });

  it("reports a byline shape change and still sends the track", () => {
    currentItem = { title: { runs: [{ text: "Song" }] } };
    run();
    videoDataEvent();
    expect(videoData).toHaveLength(1);
    expect(requireValue(videoData[0])[2]).toBeNull();
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
    expect(requireValue(videoData[0])[0]).toEqual({ videoId: "abc", title: "Raw" });
    expect(requireValue(videoData[0])[4]).toBe(false);
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
    expect(requireValue(misses[0])[0]).toBe("yt-action");
  });
});
