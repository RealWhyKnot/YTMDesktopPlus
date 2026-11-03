import { requireValue } from "../helpers/require-value";
import { describe, expect, it } from "vitest";
import { MAX_BUFFERED_BYTES } from "../../src/main/integrations/listen-along/audio-publisher";
import { VideoState } from "../../src/shared/addons/sdk";
import { MAX_BATCH_BYTES, PUBLISHER_BURST_BYTES } from "../../src/shared/audio-protocol";
import { playerState, packets, makeHarness, CREDS } from "./harness";

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
    expect(new DataView(requireValue(h.binaryFrames[0]).buffer).getUint32(4)).toBe(0);
    expect(new DataView(requireValue(h.binaryFrames[1]).buffer).getUint32(4)).toBe(1);
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
    expect(new DataView(requireValue(h.binaryFrames[1]).buffer).getUint8(1)).toBe(0);

    h.publisher.updateLocalState(playerState("dQw4w9WgXcQ", VideoState.Playing, 40));
    h.publisher.handleChunks(packets(500_000));
    expect(h.binaryFrames).toHaveLength(3);
    expect(new DataView(requireValue(h.binaryFrames[2]).buffer).getUint8(1)).toBe(1);
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
    expect(new DataView(requireValue(h.binaryFrames[0]).buffer).getUint8(1)).toBe(1);
  });

  it("keeps a full send queue plus one batch under the relay's burst allowance", () => {
    expect(MAX_BUFFERED_BYTES + MAX_BATCH_BYTES).toBeLessThan(PUBLISHER_BURST_BYTES);
  });

  it("drops batches instead of queueing on a saturated socket", () => {
    const h = readyHarness();
    requireValue(h.current()).bufferedAmount = MAX_BUFFERED_BYTES + 1;
    h.publisher.handleChunks(packets(0));
    expect(h.binaryFrames).toHaveLength(0);

    requireValue(h.current()).bufferedAmount = 0;
    h.publisher.handleChunks(packets(250_000));
    expect(h.binaryFrames).toHaveLength(1);
    expect(new DataView(requireValue(h.binaryFrames[0]).buffer).getUint8(1)).toBe(1);
  });
});
