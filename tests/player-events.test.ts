import { describe, expect, it } from "vitest";
import { createPlayerEventDeriver, SEEK_JUMP_SECONDS } from "../src/main/player-state-store/derived-events";
import { LikeStatus, RepeatMode, VideoState, type PlayerQueue, type PlayerQueueItem } from "../src/shared/addons/sdk";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

function harness() {
  const events: { event: string; payload: unknown }[] = [];
  const deriver = createPlayerEventDeriver((event, payload) => events.push({ event, payload }));
  return { events, deriver, names: () => events.map(entry => entry.event) };
}

function makeQueue(videoIds: string[], repeatMode = RepeatMode.None, selectedItemIndex = 0): PlayerQueue {
  return {
    automixItems: [],
    autoplay: false,
    isGenerating: false,
    isInfinite: false,
    items: videoIds.map(
      (id): PlayerQueueItem => ({ thumbnails: [], title: id, author: "a", duration: "1:00", selected: false, videoId: id, counterparts: null })
    ),
    repeatMode,
    selectedItemIndex
  };
}

describe("createPlayerEventDeriver", () => {
  it("seeds silently on the first snapshot", () => {
    const { deriver, events } = harness();
    deriver.next(makePlayerState({ videoDetails: makeVideoDetails(), trackState: VideoState.Playing }));
    expect(events).toEqual([]);
  });

  it("emits trackChanged with both sides and skips the seek heuristic across tracks", () => {
    const { deriver, events } = harness();
    const first = makeVideoDetails({ id: "one" });
    const second = makeVideoDetails({ id: "two" });
    deriver.next(makePlayerState({ videoDetails: first, videoProgress: 200 }));
    deriver.next(makePlayerState({ videoDetails: second, playlistId: "PL1", videoProgress: 0 }));

    expect(events).toEqual([{ event: "trackChanged", payload: { current: second, previous: first, playlistId: "PL1" } }]);
  });

  it("emits playStateChanged with the playing flag", () => {
    const { deriver, events } = harness();
    deriver.next(makePlayerState({ trackState: VideoState.Paused }));
    deriver.next(makePlayerState({ trackState: VideoState.Playing }));

    expect(events).toEqual([{ event: "playStateChanged", payload: { playing: true, trackState: VideoState.Playing } }]);
  });

  it("tells natural progress from jumps in both directions", () => {
    const { deriver, events } = harness();
    const details = makeVideoDetails({ id: "same" });
    deriver.next(makePlayerState({ videoDetails: details, videoProgress: 10 }));
    deriver.next(makePlayerState({ videoDetails: details, videoProgress: 11 }));
    expect(events).toEqual([]);

    deriver.next(makePlayerState({ videoDetails: details, videoProgress: 11 + SEEK_JUMP_SECONDS + 1 }));
    deriver.next(makePlayerState({ videoDetails: details, videoProgress: 4 }));

    expect(events).toEqual([
      { event: "seeked", payload: { fromSeconds: 11, toSeconds: 11 + SEEK_JUMP_SECONDS + 1 } },
      { event: "seeked", payload: { fromSeconds: 11 + SEEK_JUMP_SECONDS + 1, toSeconds: 4 } }
    ]);
  });

  it("reports volume and mute together", () => {
    const { deriver, events } = harness();
    deriver.next(makePlayerState({ volume: 50 }));
    deriver.next(makePlayerState({ volume: 70 }));
    deriver.next(makePlayerState({ volume: 70, muted: true }));

    expect(events).toEqual([
      { event: "volumeChanged", payload: { volume: 70, muted: false } },
      { event: "volumeChanged", payload: { volume: 70, muted: true } }
    ]);
  });

  it("flags ad transitions", () => {
    const { deriver, names } = harness();
    deriver.next(makePlayerState());
    deriver.next(makePlayerState({ adPlaying: true }));
    deriver.next(makePlayerState({ adPlaying: false }));
    expect(names()).toEqual(["adStateChanged", "adStateChanged"]);
  });

  it("compares queues by content, not identity", () => {
    const { deriver, names } = harness();
    deriver.next(makePlayerState({ queue: makeQueue(["a", "b"]) }));
    // A rebuilt but identical queue object is not a change.
    deriver.next(makePlayerState({ queue: makeQueue(["a", "b"]) }));
    expect(names()).toEqual([]);

    deriver.next(makePlayerState({ queue: makeQueue(["a", "b", "c"]) }));
    expect(names()).toEqual(["queueChanged"]);
  });

  it("emits likeChanged only for a flip on the same track", () => {
    const { deriver, names } = harness();
    deriver.next(makePlayerState({ videoDetails: makeVideoDetails({ id: "one", likeStatus: LikeStatus.Indifferent }) }));
    deriver.next(makePlayerState({ videoDetails: makeVideoDetails({ id: "one", likeStatus: LikeStatus.Like }) }));
    expect(names()).toEqual(["likeChanged"]);

    // A new track's initial like status belongs to trackChanged.
    deriver.next(makePlayerState({ videoDetails: makeVideoDetails({ id: "two", likeStatus: LikeStatus.Dislike }) }));
    expect(names()).toEqual(["likeChanged", "trackChanged"]);
  });

  it("emits repeatModeChanged only between two known modes", () => {
    const { deriver, names } = harness();
    deriver.next(makePlayerState());
    // The queue appearing is a queue change, not a repeat change.
    deriver.next(makePlayerState({ queue: makeQueue(["a"], RepeatMode.None) }));
    expect(names()).toEqual(["queueChanged"]);

    deriver.next(makePlayerState({ queue: makeQueue(["a"], RepeatMode.All) }));
    expect(names()).toEqual(["queueChanged", "queueChanged", "repeatModeChanged"]);
  });
});
