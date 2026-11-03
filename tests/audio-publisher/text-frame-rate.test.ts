import { requireValue } from "../helpers/require-value";
import { describe, expect, it, vi } from "vitest";
import { TEXT_BYTES_PER_SECOND, TEXT_FRAME_BURST, TEXT_FRAMES_PER_SECOND } from "../../src/main/integrations/listen-along/audio-publisher";
import { VideoState } from "../../src/shared/addons/sdk";
import { makeVideoDetails } from "../helpers/fake-addon-context";
import { playerState, makeHarness, CREDS } from "./harness";

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
            videoDetails: makeVideoDetails({ id: `track${String(track).padStart(6, "0")}`, title: long, author: long, album: long, durationSeconds: 300 }),
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

      requireValue(h.current()).handlers.onClose();
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

      requireValue(h.current()).handlers.onFrame({ t: "e", m: "too fast" });
      requireValue(h.current()).handlers.onClose("1008 too fast");
      expect(h.faults).toEqual([]);
      expect(h.transports).toHaveLength(1);

      vi.advanceTimersByTime(1000);
      expect(h.transports).toHaveLength(2);
      expect(requireValue(h.current()).connected).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
