import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LIVENESS_TIMEOUT_MS, RelayClient, describeClose, type LiveSocket } from "../src/main/integrations/listen-along/relay-client";
import { AudioRelayClient } from "../src/main/integrations/listen-along/audio-publisher";

describe("describeClose", () => {
  it("keeps the code, the reason and the socket error", () => {
    expect(describeClose(1008, Buffer.from("too many messages"), "")).toBe("1008 too many messages");
    expect(describeClose(1006, Buffer.alloc(0), "read ECONNRESET")).toBe("1006 (read ECONNRESET)");
    expect(describeClose(1005, Buffer.alloc(0), "")).toBe("1005");
  });
});

function fakeSocket() {
  const emitter = new EventEmitter();
  const socket = Object.assign(emitter, {
    readyState: 0,
    bufferedAmount: 0,
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(() => {
      socket.readyState = 3;
      emitter.emit("close", 1006, Buffer.alloc(0));
    })
  });
  return socket;
}

describe("socket liveness", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function relay() {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const onClose = vi.fn();
    const client = new RelayClient({ onOpen: vi.fn(), onFrame: vi.fn(), onClose }, "wss://relay.test/relay", () => {
      const socket = fakeSocket();
      sockets.push(socket);
      return socket as unknown as LiveSocket;
    });
    return { client, sockets, onClose };
  }

  it("terminates a relay socket that goes quiet for 45s and reports why", () => {
    const r = relay();
    r.client.connect();
    r.sockets[0].emit("open");

    vi.advanceTimersByTime(LIVENESS_TIMEOUT_MS - 1);
    expect(r.sockets[0].terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(r.sockets[0].terminate).toHaveBeenCalledTimes(1);
    expect(r.onClose).toHaveBeenCalledWith("1006 (no traffic for 45s)");
  });

  it("stays connected while the server keeps pinging", () => {
    const r = relay();
    r.client.connect();
    r.sockets[0].emit("open");

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(30_000);
      r.sockets[0].emit("ping");
    }

    expect(r.sockets[0].terminate).not.toHaveBeenCalled();
  });

  it("gives up on a dial that never opens", () => {
    const r = relay();
    r.client.connect();

    vi.advanceTimersByTime(LIVENESS_TIMEOUT_MS);

    expect(r.sockets[0].terminate).toHaveBeenCalledTimes(1);
  });

  it("stops watching a socket the client closed itself", () => {
    const r = relay();
    r.client.connect();
    r.client.close();

    vi.advanceTimersByTime(LIVENESS_TIMEOUT_MS * 2);

    expect(r.sockets[0].terminate).not.toHaveBeenCalled();
    expect(r.onClose).not.toHaveBeenCalled();
  });

  it("watches the audio socket the same way", () => {
    const sockets: ReturnType<typeof fakeSocket>[] = [];
    const onClose = vi.fn();
    const client = new AudioRelayClient("wss://relay.test/audio/abcdefgh", { onOpen: vi.fn(), onFrame: vi.fn(), onClose }, () => {
      const socket = fakeSocket();
      sockets.push(socket);
      return socket as unknown as LiveSocket;
    });
    client.connect();
    sockets[0].emit("open");
    vi.advanceTimersByTime(20_000);
    sockets[0].emit("message", Buffer.from("{}"), false);
    vi.advanceTimersByTime(LIVENESS_TIMEOUT_MS - 1);
    expect(sockets[0].terminate).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(onClose).toHaveBeenCalledWith("1006 (no traffic for 45s)");
  });
});
