import { describe, expect, it, vi } from "vitest";

import {
  AudioPublisher,
  HEALTHY_CONNECTION_MS,
  MAX_BUFFERED_BYTES,
  TEXT_BYTES_PER_SECOND,
  TEXT_FRAME_BURST,
  TEXT_FRAMES_PER_SECOND,
  type AudioFault,
  type AudioTransport,
  type AudioTransportHandlers
} from "../src/main/integrations/listen-along/audio-publisher";
import { VideoState, type PlayerState } from "../src/shared/addons/sdk";
import { MAX_BATCH_BYTES, PUBLISHER_BURST_BYTES, type AudioClientFrame, type AudioMetaFrame, type BatchPacket } from "../src/shared/audio-protocol";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

function playerState(videoId: string | null, trackState: VideoState, progress = 0, extra: Partial<PlayerState> = {}): PlayerState {
  return makePlayerState({
    videoDetails: videoId
      ? makeVideoDetails({
          id: videoId,
          title: "Song",
          author: "Artist",
          album: "Album",
          durationSeconds: 300,
          thumbnails: [
            { url: "https://i.ytimg.com/small.jpg", width: 60, height: 60 },
            { url: "https://i.ytimg.com/large.jpg", width: 544, height: 544 }
          ]
        })
      : null,
    videoProgress: progress,
    trackState,
    hasFullMetadata: true,
    ...extra
  });
}

function packets(at = 0): BatchPacket[] {
  return [{ timestampUs: at, payload: new Uint8Array([1, 2, 3, 4]) }];
}

function makeHarness() {
  let nowMs = 1_754_236_800_000;
  const textFrames: AudioClientFrame[] = [];
  const binaryFrames: Uint8Array[] = [];
  const updates: Array<{ streaming: boolean; webListeners: number }> = [];
  const capture = { started: 0, stopped: 0 };
  const faults: AudioFault[] = [];
  const transports: Array<{ url: string; handlers: AudioTransportHandlers; connected: boolean; closed: boolean; bufferedAmount: number }> = [];

  const publisher = new AudioPublisher({
    createTransport(url, handlers) {
      const entry = { url, handlers, connected: false, closed: false, bufferedAmount: 0 };
      transports.push(entry);
      const transport: AudioTransport = {
        connect: () => {
          entry.connected = true;
        },
        sendText: frame => textFrames.push(frame),
        sendBinary: data => binaryFrames.push(data),
        close: () => {
          entry.closed = true;
        },
        get isOpen() {
          return entry.connected && !entry.closed;
        },
        get bufferedAmount() {
          return entry.bufferedAmount;
        }
      };
      return transport;
    },
    startCapture: () => capture.started++,
    stopCapture: () => capture.stopped++,
    onUpdate: update => updates.push(update),
    onFault: fault => faults.push(fault),
    now: () => nowMs,
    log: () => {}
  });

  return {
    publisher,
    textFrames,
    binaryFrames,
    updates,
    capture,
    faults,
    transports,
    advance(ms: number) {
      nowMs += ms;
    },
    current() {
      return transports[transports.length - 1];
    },
    open() {
      this.current().handlers.onOpen();
    },
    ready(n = 0, extra: { c?: number; v?: number } = {}) {
      this.current().handlers.onFrame({ t: "ready", n, ...extra });
    },
    now() {
      return nowMs;
    },
    ofType(type: string) {
      return textFrames.filter(frame => frame.t === type);
    }
  };
}

const CREDS = { roomId: "abcdefgh", hostKey: "f".repeat(32) };

describe("AudioPublisher lifecycle", () => {
  it("starts capture, dials the owner url and authenticates", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    expect(h.capture.started).toBe(1);
    expect(h.current().url).toBe("wss://ytmdesktopplus.com/audio/abcdefgh");
    expect(h.current().connected).toBe(true);

    h.open();
    expect(h.textFrames[0]).toEqual({ t: "pub", r: CREDS.roomId, k: CREDS.hostKey });
  });

  it("is idempotent for the same room and restarts for a new one", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.publisher.setCredentials(CREDS);
    expect(h.transports).toHaveLength(1);
    expect(h.capture.started).toBe(1);

    h.publisher.setCredentials({ roomId: "baaaaaaa", hostKey: CREDS.hostKey });
    expect(h.transports).toHaveLength(2);
    expect(h.current().url).toContain("baaaaaaa");
  });

  it("stops capture and the socket when credentials go away", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready(1);
    h.publisher.setCredentials(null);
    expect(h.capture.stopped).toBeGreaterThan(0);
    expect(h.current().closed).toBe(true);
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: false, webListeners: 0 });
  });

  it("reports streaming on ready and the live listener count", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready(2);
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: true, webListeners: 2 });

    h.current().handlers.onFrame({ t: "n", n: 7 });
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: true, webListeners: 7 });
  });

  it("gives up for good on a fatal relay error", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();
    h.current().handlers.onFrame({ t: "e", m: "bad key" });
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: false, webListeners: 0 });

    h.current().handlers.onClose();
    expect(h.transports).toHaveLength(1);
  });

  it("tears the capture down when the relay refuses the room", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready(3);
    const stoppedBefore = h.capture.stopped;
    h.current().handlers.onFrame({ t: "e", m: "room closed" });

    expect(h.capture.stopped).toBe(stoppedBefore + 1);
    expect(h.current().closed).toBe(true);
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: false, webListeners: 0 });
  });

  it("waits after a refusal and tries the room again when main hands the same credentials back", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();
    h.current().handlers.onFrame({ t: "e", m: "room closed" });
    h.current().handlers.onClose();

    expect(h.faults).toEqual(["refused"]);
    expect(h.transports).toHaveLength(1);

    h.publisher.setCredentials(CREDS);
    expect(h.transports).toHaveLength(2);
    expect(h.capture.started).toBe(2);
  });

  it("keeps its credentials when the capture fails and reports a fault instead of restarting", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready(2);
    const stoppedBefore = h.capture.stopped;

    h.publisher.handleCaptureStatus({ error: "render process gone" });
    h.publisher.handleCaptureStatus({ error: "render process gone" });

    expect(h.faults).toEqual(["capture"]);
    expect(h.capture).toEqual({ started: 1, stopped: stoppedBefore + 1 });
    expect(h.current().closed).toBe(true);
    expect(h.updates.at(-1)).toEqual({ streaming: false, webListeners: 0 });

    h.publisher.setCredentials(CREDS);
    expect(h.capture.started).toBe(2);
    expect(h.transports).toHaveLength(2);
  });

  it("tears the capture down once it runs out of reconnect attempts", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      h.publisher.setCredentials(CREDS);
      h.open();
      h.ready();
      const stoppedBefore = h.capture.stopped;

      for (let attempt = 0; attempt <= 30; attempt++) {
        h.current().handlers.onClose();
        vi.advanceTimersByTime(30_000);
      }

      expect(h.capture.stopped).toBe(stoppedBefore + 1);
      expect(h.updates[h.updates.length - 1]).toEqual({ streaming: false, webListeners: 0 });
      expect(h.faults).toEqual(["relay"]);

      h.publisher.setCredentials(CREDS);
      expect(h.current().connected).toBe(true);
      expect(h.current().closed).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts a connection that drops right after ready as a failed attempt", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      h.publisher.setCredentials(CREDS);

      for (let attempt = 0; attempt <= 30; attempt++) {
        h.open();
        h.ready();
        h.current().handlers.onClose();
        vi.advanceTimersByTime(30_000);
      }

      expect(h.faults).toEqual(["relay"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("starts counting again after a connection that stayed up", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      h.publisher.setCredentials(CREDS);

      for (let attempt = 0; attempt <= 40; attempt++) {
        h.open();
        h.ready();
        h.advance(HEALTHY_CONNECTION_MS);
        h.current().handlers.onClose();
        vi.advanceTimersByTime(30_000);
      }

      expect(h.faults).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops for good when the relay is newer and rejects its frames", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready(0, { v: 2 });

    h.current().handlers.onFrame({ t: "e", m: "bad frame" });

    expect(h.faults).toEqual(["outdated"]);
    h.publisher.setCredentials(CREDS);
    expect(h.transports).toHaveLength(1);
  });

  it("keeps going after a bad frame from a relay on the same version or one that sends none", () => {
    for (const extra of [{ v: 1 }, {}]) {
      const h = makeHarness();
      h.publisher.setCredentials(CREDS);
      h.open();
      h.ready(0, extra);

      h.current().handlers.onFrame({ t: "e", m: "bad frame" });

      expect(h.faults).toEqual([]);
      expect(h.current().closed).toBe(false);
    }
  });

  it("redials at once when asked, without waiting out a backoff", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      h.publisher.setCredentials(CREDS);
      h.open();
      h.ready();

      h.publisher.redial();

      expect(h.transports).toHaveLength(2);
      expect(h.transports[0].closed).toBe(true);
      expect(h.current().connected).toBe(true);
      expect(h.updates.at(-1)).toEqual({ streaming: false, webListeners: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("AudioPublisher chunk gates", () => {
  function readyHarness() {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();
    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 10));
    return h;
  }

  it("sends batches with monotonic sequence numbers while playing", () => {
    const h = readyHarness();
    h.publisher.handleChunks(packets(0));
    h.publisher.handleChunks(packets(250_000));
    expect(h.binaryFrames).toHaveLength(2);
    expect(new DataView(h.binaryFrames[0].buffer).getUint32(4)).toBe(0);
    expect(new DataView(h.binaryFrames[1].buffer).getUint32(4)).toBe(1);
  });

  it("drops nothing before ready", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.publisher.handleChunks(packets());
    expect(h.binaryFrames).toHaveLength(0);
  });

  it("reports an ad in the status, leaves gating its audio to the page and flags the discontinuity after it", () => {
    const h = readyHarness();
    h.publisher.handleChunks(packets(0));

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 10, { adPlaying: true }));
    expect(h.ofType("status").pop()).toEqual({ t: "status", s: "ad" });
    h.publisher.handleChunks(packets(250_000));
    expect(h.binaryFrames).toHaveLength(2);
    expect(new DataView(h.binaryFrames[1].buffer).getUint8(1)).toBe(0);

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 40));
    h.publisher.handleChunks(packets(500_000));
    expect(h.binaryFrames).toHaveLength(3);
    expect(new DataView(h.binaryFrames[2].buffer).getUint8(1)).toBe(1);
    expect(h.ofType("status").pop()).toEqual({ t: "status", s: "live" });
  });

  it("keeps sending while player state stops arriving", () => {
    const h = readyHarness();

    h.advance(10_000);
    h.publisher.handleChunks(packets(0));
    h.advance(60_000);
    h.publisher.handleChunks(packets(250_000));

    expect(h.binaryFrames).toHaveLength(2);
  });

  it("sends before any player state has arrived", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();

    h.advance(10_000);
    h.publisher.handleChunks(packets());

    expect(h.binaryFrames).toHaveLength(1);
  });

  it("measures a pause from its start, however many updates follow", () => {
    const h = readyHarness();
    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Paused, 10));
    h.advance(4000);
    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Paused, 10));
    h.publisher.handleChunks(packets(0));
    expect(h.binaryFrames).toHaveLength(1);

    h.advance(1500);
    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Paused, 10));
    h.publisher.handleChunks(packets(250_000));
    expect(h.binaryFrames).toHaveLength(1);
  });

  it("closes the gate for a stopped track but not for buffering", () => {
    const h = readyHarness();
    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Buffering, 10));
    h.advance(6000);
    h.publisher.handleChunks(packets(0));
    expect(h.binaryFrames).toHaveLength(1);

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Unknown, 10));
    h.advance(6000);
    h.publisher.handleChunks(packets(250_000));
    expect(h.binaryFrames).toHaveLength(1);
  });

  it("stops sending after a pause outlives the gate", () => {
    const h = readyHarness();
    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Paused, 10));
    h.advance(6000);
    h.publisher.handleChunks(packets());
    expect(h.binaryFrames).toHaveLength(0);

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 10));
    h.publisher.handleChunks(packets());
    expect(h.binaryFrames).toHaveLength(1);
    expect(new DataView(h.binaryFrames[0].buffer).getUint8(1)).toBe(1);
  });

  it("keeps a full send queue plus one batch under the relay's burst allowance", () => {
    expect(MAX_BUFFERED_BYTES + MAX_BATCH_BYTES).toBeLessThan(PUBLISHER_BURST_BYTES);
  });

  it("drops batches instead of queueing on a saturated socket", () => {
    const h = readyHarness();
    h.current().bufferedAmount = MAX_BUFFERED_BYTES + 1;
    h.publisher.handleChunks(packets(0));
    expect(h.binaryFrames).toHaveLength(0);

    h.current().bufferedAmount = 0;
    h.publisher.handleChunks(packets(250_000));
    expect(h.binaryFrames).toHaveLength(1);
    expect(new DataView(h.binaryFrames[0].buffer).getUint8(1)).toBe(1);
  });
});

describe("AudioPublisher metadata", () => {
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

    // Same track, richer metadata: resend once.
    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 5));
    expect(h.ofType("meta")).toHaveLength(2);

    // Steady playback: nothing.
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
            { url: `https://i.ytimg.com/${"a".repeat(600)}.jpg`, width: 1200, height: 1200 }
          ]
        }),
        trackState: VideoState.Playing,
        hasFullMetadata: true
      })
    );

    const meta = h.ofType("meta").pop() as AudioMetaFrame;
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
        hasFullMetadata: true
      })
    );

    const meta = h.ofType("meta").pop() as AudioMetaFrame;
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

describe("AudioPublisher text frame rate", () => {
  it("keeps rapid seeks under the relay's text frame limit and sends the latest position", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      h.publisher.setCredentials(CREDS);
      h.open();
      h.ready();
      const before = h.textFrames.length;

      for (let seek = 0; seek < 200; seek++) h.publisher.updateLocalState(playerState("track000001", VideoState.Playing, seek * 5));
      expect(h.textFrames.length - before).toBeLessThanOrEqual(TEXT_FRAME_BURST);

      const perSecond: number[] = [];
      for (let second = 0; second < 5; second++) {
        const start = h.textFrames.length;
        for (let tick = 0; tick < 10; tick++) {
          for (let seek = 0; seek < 20; seek++)
            h.publisher.updateLocalState(playerState("track000001", VideoState.Playing, (second * 10 + tick) * 200 + seek * 5));
          h.advance(100);
          vi.advanceTimersByTime(100);
        }
        perSecond.push(h.textFrames.length - start);
      }
      expect(Math.max(...perSecond)).toBeLessThanOrEqual(TEXT_FRAMES_PER_SECOND + 1);

      h.advance(1000);
      vi.advanceTimersByTime(1000);
      const anchors = h.ofType("anchor");
      expect(anchors.at(-1)).toEqual({ t: "anchor", a: h.now() - 1100 - 1000 * (49 * 200 + 19 * 5), p: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps big metadata frames under the byte budget", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      h.publisher.setCredentials(CREDS);
      h.open();
      h.ready();
      const long = "x".repeat(200);
      let bytes = 0;
      let counted = h.textFrames.length;
      for (let track = 0; track < 100; track++) {
        h.publisher.updateLocalState(
          playerState(`track${String(track).padStart(6, "0")}`, VideoState.Playing, 0, {
            videoDetails: makeVideoDetails({ id: `track${String(track).padStart(6, "0")}`, title: long, author: long, album: long, durationSeconds: 300 })
          })
        );
        h.advance(50);
        vi.advanceTimersByTime(50);
        bytes += h.textFrames.slice(counted).reduce((sum, frame) => sum + Buffer.byteLength(JSON.stringify(frame)), 0);
        counted = h.textFrames.length;
      }
      expect(bytes).toBeLessThanOrEqual(TEXT_BYTES_PER_SECOND * 6);
      h.advance(2000);
      vi.advanceTimersByTime(2000);
      expect(h.ofType("meta").at(-1)).toMatchObject({ v: "track000099" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops queued frames when the connection is replaced", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      h.publisher.setCredentials(CREDS);
      h.open();
      h.ready();
      for (let seek = 0; seek < 100; seek++) h.publisher.updateLocalState(playerState("track000001", VideoState.Playing, seek * 5));
      const sent = h.textFrames.length;

      h.current().handlers.onClose();
      vi.advanceTimersByTime(500);

      expect(h.textFrames).toHaveLength(sent);
    } finally {
      vi.useRealTimers();
    }
  });

  it("backs off and reconnects after a too fast error", () => {
    vi.useFakeTimers();
    try {
      const h = makeHarness();
      h.publisher.setCredentials(CREDS);
      h.open();
      h.ready();

      h.current().handlers.onFrame({ t: "e", m: "too fast" });
      h.current().handlers.onClose("1008 too fast");
      expect(h.faults).toEqual([]);
      expect(h.transports).toHaveLength(1);

      vi.advanceTimersByTime(1000);
      expect(h.transports).toHaveLength(2);
      expect(h.current().connected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
