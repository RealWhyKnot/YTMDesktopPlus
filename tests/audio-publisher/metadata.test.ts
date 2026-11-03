import { describe, expect, it } from "vitest";
import { VideoState } from "../../src/shared/addons/sdk";
import { requireValue } from "../helpers/require-value";
import { makePlayerState, makeVideoDetails } from "../helpers/fake-addon-context";
import { playerState, makeHarness, CREDS } from "./harness";
import { partialPlayerState } from "../helpers/partial-player-state";

describe("AudioPublisher metadata", () => {
  it("publishes partial metadata without empty text or invalid artwork", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();
    h.publisher.updateLocalState(partialPlayerState({ videoId: "dQw4w9WgXcQ", thumbnail: { thumbnails: [{ url: "https://i.ytimg.com/partial.jpg" }] } }));
    const meta = requireValue(h.ofType("meta").pop());
    expect(meta.v).toBe("dQw4w9WgXcQ");
    expect(meta.title).toBeUndefined();
    expect(meta.artist).toBeUndefined();
    expect(meta.coverUrl).toBeUndefined();
  });
  it("sends cfg from the capture and replays it after ready", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.publisher.handleCaptureStatus({ cfg: { sr: 48000, ch: 2, br: 128000 } });
    expect(h.ofType("cfg")).toHaveLength(0);

    h.open();
    h.ready();
    expect(h.ofType("cfg").pop()).toEqual({ t: "cfg", codec: "opus", sr: 48000, ch: 2, br: 128000 });
  });

  it("publishes meta on track change and metadata landing, with the largest artwork", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 0, { hasFullMetadata: false }));
    const first = h.ofType("meta");
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ v: "dQw4w9WgXcQ", title: "Song", artist: "Artist", coverUrl: "https://i.ytimg.com/large.jpg", durS: 300 });

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 5));
    expect(h.ofType("meta")).toHaveLength(2);

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 10));
    expect(h.ofType("meta")).toHaveLength(2);

    h.publisher.updateLocalState(playerState("otherTrack", VideoState.Playing, 0));
    expect(h.ofType("meta")).toHaveLength(3);
  });

  it("publishes anchors only on meaningful change", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 10));
    expect(h.ofType("anchor")).toHaveLength(1);

    h.advance(5000);
    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 15));
    expect(h.ofType("anchor")).toHaveLength(1);

    h.advance(1000);
    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 100));
    expect(h.ofType("anchor")).toHaveLength(2);
  });

  it("stamps anchors with the relay clock from ready, falling back to the room clock, then local time", () => {
    const progress = 10;
    const expectAnchor = (h: ReturnType<typeof makeHarness>, offsetMs: number) => {
      h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, progress));
      expect(h.ofType("anchor").at(-1)).toEqual({ t: "anchor", a: h.now() + offsetMs - progress * 1000, p: 1 });
    };

    const fromReady = makeHarness();
    fromReady.publisher.setClockOffset(2_000);
    fromReady.publisher.setCredentials(CREDS);
    fromReady.open();
    fromReady.advance(100);
    fromReady.ready(0, { c: fromReady.now() - 100 + 50 + 7_000 });
    expectAnchor(fromReady, 7_000);

    const fromRoom = makeHarness();
    fromRoom.publisher.setClockOffset(2_000);
    fromRoom.publisher.setCredentials(CREDS);
    fromRoom.open();
    fromRoom.ready();
    expectAnchor(fromRoom, 2_000);

    const local = makeHarness();
    local.publisher.setCredentials(CREDS);
    local.open();
    local.ready();
    expectAnchor(local, 0);
  });

  it("sends meta without artwork the relay would reject, and trims text to its limits", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();

    h.publisher.updateLocalState(
      makePlayerState({
        videoDetails: makeVideoDetails({
          id: "dQw4w9WgXcQ",
          title: `  A\u0007${"x".repeat(300)}`,
          author: "\u0001\u0002",
          album: "Album",
          durationSeconds: 300,
          thumbnails: [
            { url: "https://i.ytimg.com/ok.jpg", width: 60, height: 60 },
            { url: "https://i.ytimg.com/has space.jpg", width: 544, height: 544 },
            { url: `https://i.ytimg.com/${"a".repeat(600)}.jpg`, width: 1200, height: 1200 },
          ],
        }),
        trackState: VideoState.Playing,
        hasFullMetadata: true,
      })
    );

    const meta = requireValue(h.ofType("meta").pop());
    expect(meta.coverUrl).toBe("https://i.ytimg.com/ok.jpg");
    expect(meta.title).toBe(`A${"x".repeat(199)}`);
    expect(meta.artist).toBeUndefined();
    expect(meta.album).toBe("Album");
  });

  it("leaves the cover out when no thumbnail passes", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();

    h.publisher.updateLocalState(
      makePlayerState({
        videoDetails: makeVideoDetails({ id: "dQw4w9WgXcQ", title: "Song", thumbnails: [{ url: "http://i.ytimg.com/a.jpg", width: 60, height: 60 }] }),
        trackState: VideoState.Playing,
        hasFullMetadata: true,
      })
    );

    const meta = requireValue(h.ofType("meta").pop());
    expect(meta).toMatchObject({ t: "meta", v: "dQw4w9WgXcQ", title: "Song" });
    expect(meta.coverUrl).toBeUndefined();
  });

  it("reflects mute in the status", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();
    expect(h.ofType("status").pop()).toEqual({ t: "status", s: "live" });

    h.publisher.handleCaptureStatus({ muted: true });
    expect(h.ofType("status").pop()).toEqual({ t: "status", s: "muted" });

    h.publisher.handleCaptureStatus({ muted: false });
    expect(h.ofType("status").pop()).toEqual({ t: "status", s: "live" });
  });
});
