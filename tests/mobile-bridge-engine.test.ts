import { describe, expect, it } from "vitest";
import {
  EXPIRY_SLACK_MS,
  LOCAL_RING_SIZE,
  MIRROR_EXPIRY_MS,
  type Mirror,
  MirrorEngine,
  POLL_INTERVAL_MS,
  type RemoteTrack,
  SLOW_AFTER_QUIET_MS,
  SLOW_POLL_INTERVAL_MS,
} from "../src/addons/bundled/mobile-bridge/mirror-engine";

const track = (videoId: string, durationSeconds: number | null = null): RemoteTrack => ({
  videoId,
  title: `title-${videoId}`,
  author: "author",
  thumbnailUrl: null,
  durationSeconds,
});

function makeHarness(durations: Record<string, number | null> = {}) {
  let now = 0;
  let nextTimerId = 1;
  const timers: { id: number; at: number; fn: () => void }[] = [];
  const changes: (Mirror | null)[] = [];
  const durationLookups: string[] = [];
  let head: RemoteTrack[] = [];
  let fetches = 0;
  let isFailNextFetch = false;

  const engine = new MirrorEngine({
    fetchHead: () => {
      fetches++;
      if (isFailNextFetch) {
        isFailNextFetch = false;
        return Promise.reject(new Error("network down"));
      }
      return Promise.resolve(head);
    },
    fetchDuration: (videoId) => {
      durationLookups.push(videoId);
      return Promise.resolve(durations[videoId] ?? null);
    },
    onChange: (mirror) => changes.push(mirror),
    now: () => now,
    setTimer: (fn, ms) => {
      const id = nextTimerId++;
      timers.push({ id, at: now + ms, fn });
      return id;
    },
    clearTimer: (handle) => {
      const index = timers.findIndex((timer) => timer.id === handle);
      if (index >= 0) timers.splice(index, 1);
    },
  });

  const advance = async (ms: number) => {
    const target = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const due = timers.find((timer) => timer.at <= target);
      if (!due) break;
      timers.splice(timers.indexOf(due), 1);
      now = Math.max(now, due.at);
      due.fn();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }
    now = target;
  };

  return {
    engine,
    changes,
    advance,
    durationLookups,
    setHead: (items: RemoteTrack[]) => (head = items),
    failNext: () => (isFailNextFetch = true),
    fetchCount: () => fetches,
  };
}

const idle = { playing: false, videoId: null as string | null, hasFullMetadata: false };
const playingLocal = (videoId: string) => ({ playing: true, videoId, hasFullMetadata: true });

describe("mirror engine", () => {
  it("mirrors the history head while the desktop is idle", async () => {
    const h = makeHarness();
    h.setHead([track("phone1")]);
    h.engine.start();
    await h.advance(0);
    expect(h.changes).toEqual([{ track: track("phone1"), firstSeenMs: 0 }]);
  });

  it("never mirrors a track the desktop itself played", async () => {
    const h = makeHarness();
    h.engine.noteLocalState(playingLocal("localvid"));
    h.engine.noteLocalState(idle);
    h.setHead([track("localvid")]);
    h.engine.start();
    await h.advance(POLL_INTERVAL_MS);
    expect(h.changes).toEqual([]);
  });

  it("stops polling and clears instantly when local playback starts", async () => {
    const h = makeHarness();
    h.setHead([track("phone1")]);
    h.engine.start();
    await h.advance(0);
    expect(h.changes.at(-1)).not.toBeNull();

    h.engine.noteLocalState(playingLocal("localvid"));
    expect(h.changes.at(-1)).toBeNull();

    const before = h.fetchCount();
    await h.advance(POLL_INTERVAL_MS * 4);
    expect(h.fetchCount()).toBe(before);
  });

  it("resumes polling promptly when local playback stops", async () => {
    const h = makeHarness();
    h.engine.noteLocalState(playingLocal("localvid"));
    h.engine.start();
    await h.advance(POLL_INTERVAL_MS * 2);
    expect(h.fetchCount()).toBe(0);

    h.setHead([track("phone1")]);
    h.engine.noteLocalState(idle);
    await h.advance(0);
    const firstSeenMs: unknown = expect.any(Number);
    expect(h.changes.at(-1)).toEqual({ track: track("phone1"), firstSeenMs });
  });

  it("follows the current head, including a head that reverts after a quick skip", async () => {
    const h = makeHarness();
    h.setHead([track("a")]);
    h.engine.start();
    await h.advance(0);
    h.setHead([track("b")]);
    await h.advance(POLL_INTERVAL_MS);
    h.setHead([track("a")]);
    await h.advance(POLL_INTERVAL_MS);
    expect(h.changes.map((change) => change?.track.videoId)).toEqual(["a", "b", "a"]);
  });

  it("uses the track duration plus slack as the expiry when the history row carries one", async () => {
    const h = makeHarness();
    h.setHead([track("longmix", 600)]);
    h.engine.start();
    await h.advance(0);
    expect(h.durationLookups).toEqual([]);

    await h.advance(MIRROR_EXPIRY_MS + POLL_INTERVAL_MS * 2);
    expect(h.changes.at(-1)).not.toBeNull();

    await h.advance(600_000 + EXPIRY_SLACK_MS);
    expect(h.changes.at(-1)).toBeNull();
  });

  it("looks a missing duration up once, remembers it, and never asks twice", async () => {
    const h = makeHarness({ shortsong: 120 });
    h.setHead([track("shortsong")]);
    h.engine.start();
    await h.advance(0);
    expect(h.durationLookups).toEqual(["shortsong"]);

    await h.advance(120_000 + EXPIRY_SLACK_MS + POLL_INTERVAL_MS * 2);
    expect(h.changes.at(-1)).toBeNull();

    h.setHead([track("other", 300)]);
    await h.advance(POLL_INTERVAL_MS);
    h.setHead([track("shortsong")]);
    await h.advance(POLL_INTERVAL_MS);
    expect(h.changes.at(-1)?.track.videoId).toBe("shortsong");
    expect(h.durationLookups).toEqual(["shortsong"]);
  });

  it("keeps the flat expiry when the duration lookup answers nothing, without retrying", async () => {
    const h = makeHarness({ mystery: null });
    h.setHead([track("mystery")]);
    h.engine.start();
    await h.advance(0);
    await h.advance(MIRROR_EXPIRY_MS - POLL_INTERVAL_MS);
    expect(h.changes.at(-1)).not.toBeNull();
    await h.advance(POLL_INTERVAL_MS * 3);
    expect(h.changes.at(-1)).toBeNull();
    expect(h.durationLookups).toEqual(["mystery"]);
  });

  it("expires the mirror after a quiet period and stays quiet until the head changes", async () => {
    const h = makeHarness();
    h.setHead([track("phone1")]);
    h.engine.start();
    await h.advance(0);
    await h.advance(MIRROR_EXPIRY_MS + POLL_INTERVAL_MS * 2);
    expect(h.changes.at(-1)).toBeNull();

    const afterExpiry = h.changes.length;
    await h.advance(SLOW_POLL_INTERVAL_MS * 3);
    expect(h.changes.length).toBe(afterExpiry);

    h.setHead([track("phone2")]);
    await h.advance(SLOW_POLL_INTERVAL_MS * 2);
    expect(h.changes.at(-1)?.track.videoId).toBe("phone2");
  });

  it("keeps polling after a fetch failure", async () => {
    const h = makeHarness();
    h.failNext();
    h.setHead([track("phone1")]);
    h.engine.start();
    await h.advance(0);
    expect(h.changes).toEqual([]);
    await h.advance(POLL_INTERVAL_MS);
    const firstSeenMs: unknown = expect.any(Number);
    expect(h.changes.at(-1)).toEqual({ track: track("phone1"), firstSeenMs });
  });

  it("slows the poll cadence after a long quiet stretch", async () => {
    const h = makeHarness();
    h.setHead([]);
    h.engine.start();
    await h.advance(SLOW_AFTER_QUIET_MS + POLL_INTERVAL_MS);
    const atQuiet = h.fetchCount();
    await h.advance(SLOW_POLL_INTERVAL_MS * 3);
    const later = h.fetchCount();
    expect(later - atQuiet).toBeLessThanOrEqual(4);
    expect(later - atQuiet).toBeGreaterThanOrEqual(2);
  });

  it("caps the local ring so old local plays age out", async () => {
    const h = makeHarness();
    h.engine.noteLocalState(playingLocal("old"));
    for (let i = 0; i < LOCAL_RING_SIZE; i++) {
      h.engine.noteLocalState(playingLocal(`filler-${i}`));
    }
    h.engine.noteLocalState(idle);
    h.setHead([track("old")]);
    h.engine.start();
    await h.advance(0);
    expect(h.changes.at(-1)?.track.videoId).toBe("old");
  });

  it("stops cleanly", async () => {
    const h = makeHarness();
    h.setHead([track("phone1")]);
    h.engine.start();
    await h.advance(0);
    h.engine.stop();
    const before = h.fetchCount();
    await h.advance(POLL_INTERVAL_MS * 3);
    expect(h.fetchCount()).toBe(before);
  });
});
