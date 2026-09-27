import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installQueueProjection, type ProjectedQueue } from "../src/shared/queue-projection";
import playerStateStore, { RepeatMode } from "../src/main/player-state-store";

type Projector = (queue: unknown) => ProjectedQueue | null;

let project: Projector;

beforeEach(() => {
  const stub: { __ytmdProjectQueue?: Projector } = {};
  vi.stubGlobal("window", stub);
  installQueueProjection();
  project = stub.__ytmdProjectQueue!;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const renderer = (videoId: string, extra: Record<string, unknown> = {}) => ({
  videoId,
  title: { runs: [{ text: "Song " }, { text: videoId }] },
  shortBylineText: { runs: [{ text: "Artist" }, { text: " & Friend" }] },
  lengthText: { runs: [{ text: "3:21" }] },
  thumbnail: { thumbnails: [{ url: `https://i.ytimg.com/${videoId}.jpg`, width: 60, height: 60, extra: "dropped" }] },
  menu: { menuRenderer: { items: new Array(20).fill({ menuServiceItemRenderer: { text: { runs: [{ text: "x" }] } } }) } },
  navigationEndpoint: { watchEndpoint: { videoId, playlistId: "RD" } },
  ...extra
});

describe("queue projection", () => {
  it("keeps only the fields the app reads from a playlist panel renderer", () => {
    const queue = project({
      items: [{ playlistPanelVideoRenderer: renderer("a", { selected: true }) }],
      automixItems: [],
      autoplay: true,
      isInfinite: true,
      repeatMode: "ONE"
    });

    expect(queue).toEqual({
      items: [
        {
          thumbnails: [{ url: "https://i.ytimg.com/a.jpg", width: 60, height: 60 }],
          title: "Song a",
          author: "Artist & Friend",
          duration: "3:21",
          selected: true,
          videoId: "a",
          counterparts: null
        }
      ],
      automixItems: [],
      autoplay: true,
      isGenerating: false,
      isInfinite: true,
      repeatMode: "ONE"
    });
  });

  it("unwraps wrapper items and their counterparts", () => {
    const queue = project({
      items: [
        {
          playlistPanelVideoWrapperRenderer: {
            primaryRenderer: { playlistPanelVideoRenderer: renderer("audio") },
            counterpart: [{ counterpartRenderer: { playlistPanelVideoRenderer: renderer("video") } }, { counterpartRenderer: {} }]
          }
        }
      ],
      automixItems: [{ playlistPanelVideoRenderer: renderer("next") }]
    });

    expect(queue.items[0].videoId).toBe("audio");
    expect(queue.items[0].counterparts?.map(item => item.videoId)).toEqual(["video"]);
    expect(queue.automixItems.map(item => item.videoId)).toEqual(["next"]);
  });

  it("keeps a slot for an entry it cannot read so queue indexes still line up", () => {
    const queue = project({ items: [{ somethingNew: {} }, { playlistPanelVideoRenderer: renderer("b", { selected: true }) }] });

    expect(queue.items[0]).toBeNull();
    expect(queue.items[1].videoId).toBe("b");
  });

  it("passes a missing queue through as null", () => {
    expect(project(null)).toBeNull();
    expect(project(undefined)).toBeNull();
  });

  it("is a small fraction of what YouTube Music keeps per item", () => {
    const raw = { items: Array.from({ length: 50 }, (_, i) => ({ playlistPanelVideoRenderer: renderer(`v${i}`) })), automixItems: [] as unknown[] };

    expect(JSON.stringify(project(raw)).length * 5).toBeLessThan(JSON.stringify(raw).length);
  });
});

describe("player state store queue", () => {
  it("works out the selected index past unreadable entries and maps the repeat mode", () => {
    const queue = project({ items: [{ somethingNew: {} }, { playlistPanelVideoRenderer: renderer("b", { selected: true }) }], repeatMode: "ALL" });

    playerStateStore.updateQueue(queue);

    expect(playerStateStore.getQueue()).toMatchObject({ selectedItemIndex: 1, repeatMode: RepeatMode.All });
  });

  it("clears the queue", () => {
    playerStateStore.updateQueue(project({ items: [] }));
    playerStateStore.updateQueue(null);

    expect(playerStateStore.getQueue()).toBeNull();
  });
});
