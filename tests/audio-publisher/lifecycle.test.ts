import { requireValue } from "../helpers/require-value";
import { describe, expect, it, vi } from "vitest";
import { HEALTHY_CONNECTION_MS } from "../../src/main/integrations/listen-along/audio-publisher";
import { makeHarness, CREDS } from "./harness";

describe("AudioPublisher lifecycle", () => {
  it("starts capture, dials the owner url and authenticates", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    expect(h.capture.started).toBe(1);
    expect(requireValue(h.current()).url).toBe("wss://ytmdesktopplus.com/audio/abcdefgh");
    expect(requireValue(h.current()).connected).toBe(true);

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
    expect(requireValue(h.current()).url).toContain("baaaaaaa");
  });

  it("stops capture and the socket when credentials go away", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready(1);
    h.publisher.setCredentials(null);
    expect(h.capture.stopped).toBeGreaterThan(0);
    expect(requireValue(h.current()).closed).toBe(true);
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: false, webListeners: 0 });
  });

  it("reports streaming on ready and the live listener count", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready(2);
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: true, webListeners: 2 });

    requireValue(h.current()).handlers.onFrame({ t: "n", n: 7 });
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: true, webListeners: 7 });
  });

  it("gives up for good on a fatal relay error", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();
    requireValue(h.current()).handlers.onFrame({ t: "e", m: "bad key" });
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: false, webListeners: 0 });

    requireValue(h.current()).handlers.onClose();
    expect(h.transports).toHaveLength(1);
  });

  it("tears the capture down when the relay refuses the room", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready(3);
    const stoppedBefore = h.capture.stopped;
    requireValue(h.current()).handlers.onFrame({ t: "e", m: "room closed" });

    expect(h.capture.stopped).toBe(stoppedBefore + 1);
    expect(requireValue(h.current()).closed).toBe(true);
    expect(h.updates[h.updates.length - 1]).toEqual({ streaming: false, webListeners: 0 });
  });

  it("waits after a refusal and tries the room again when main hands the same credentials back", () => {
    const h = makeHarness();
    h.publisher.setCredentials(CREDS);
    h.open();
    h.ready();
    requireValue(h.current()).handlers.onFrame({ t: "e", m: "room closed" });
    requireValue(h.current()).handlers.onClose();

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
    expect(requireValue(h.current()).closed).toBe(true);
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
        requireValue(h.current()).handlers.onClose();
        vi.advanceTimersByTime(30_000);
      }

      expect(h.capture.stopped).toBe(stoppedBefore + 1);
      expect(h.updates[h.updates.length - 1]).toEqual({ streaming: false, webListeners: 0 });
      expect(h.faults).toEqual(["relay"]);

      h.publisher.setCredentials(CREDS);
      expect(requireValue(h.current()).connected).toBe(true);
      expect(requireValue(h.current()).closed).toBe(false);
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
        requireValue(h.current()).handlers.onClose();
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
        requireValue(h.current()).handlers.onClose();
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

    requireValue(h.current()).handlers.onFrame({ t: "e", m: "bad frame" });

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

      requireValue(h.current()).handlers.onFrame({ t: "e", m: "bad frame" });

      expect(h.faults).toEqual([]);
      expect(requireValue(h.current()).closed).toBe(false);
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
      expect(requireValue(h.transports[0]).closed).toBe(true);
      expect(requireValue(h.current()).connected).toBe(true);
      expect(h.updates.at(-1)).toEqual({ streaming: false, webListeners: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});
