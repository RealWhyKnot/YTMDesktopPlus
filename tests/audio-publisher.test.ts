import { describe, expect, it } from "vitest";

import { AudioPublisher, type AudioTransport, type AudioTransportHandlers } from "../src/main/integrations/listen-along/audio-publisher";
import { VideoState, type PlayerState } from "../src/main/player-state-store";
import type { AudioClientFrame, BatchPacket } from "../src/shared/audio-protocol";

function playerState(videoId: string | null, trackState: VideoState, progress = 0, extra: Partial<PlayerState> = {}): PlayerState {
  return {
    videoDetails: videoId
      ? {
          id: videoId,
          title: "Song",
          author: "Artist",
          album: "Album",
          durationSeconds: 300,
          thumbnails: [
            { url: "https://i.ytimg.com/small.jpg", width: 60, height: 60 },
            { url: "https://i.ytimg.com/large.jpg", width: 544, height: 544 }
          ]
        }
      : null,
    videoProgress: progress,
    trackState,
    adPlaying: false,
    hasFullMetadata: true,
    ...extra
  } as unknown as PlayerState;
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
    now: () => nowMs,
    log: () => {}
  });

  return {
    publisher,
    textFrames,
    binaryFrames,
    updates,
    capture,
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
    ready(n = 0) {
      this.current().handlers.onFrame({ t: "ready", n });
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

  it("gates ads and flags the discontinuity on resume", () => {
    const h = readyHarness();
    h.publisher.handleChunks(packets(0));

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 10, { adPlaying: true }));
    h.publisher.handleChunks(packets(250_000));
    expect(h.binaryFrames).toHaveLength(1);
    expect(h.ofType("status").pop()).toEqual({ t: "status", s: "ad" });

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 40));
    h.publisher.handleChunks(packets(500_000));
    expect(h.binaryFrames).toHaveLength(2);
    expect(new DataView(h.binaryFrames[1].buffer).getUint8(1)).toBe(1);
    expect(h.ofType("status").pop()).toEqual({ t: "status", s: "live" });
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

  it("drops batches instead of queueing on a saturated socket", () => {
    const h = readyHarness();
    h.current().bufferedAmount = 500_000;
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
