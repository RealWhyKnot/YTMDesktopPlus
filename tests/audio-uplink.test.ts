import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import type { MessagePortMain } from "electron";

import { AudioUplink, slimState, type AudioUplinkDeps, type UplinkProcess } from "../src/main/media/audio-uplink";
import { cleanAudioPackets, createAudioUplinkService, type MediaPort, type UplinkCommand, type UplinkEvent } from "../src/main/services/audio-uplink";
import type { AudioTransport, AudioTransportHandlers } from "../src/main/integrations/listen-along/audio-publisher";
import type { AudioClientFrame } from "../src/shared/audio-protocol";
import { VideoState } from "../src/shared/addons/sdk";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

const CREDS = { roomId: "abcdefgh", hostKey: "f".repeat(32) };
const PLAYING = slimState(makePlayerState({ videoDetails: makeVideoDetails({ id: "dQw4w9WgXcQ" }), trackState: VideoState.Playing, videoProgress: 10 }));

function fakeMediaPort() {
  let listener: ((event: { data: unknown }) => void) | null = null;
  const port = {
    started: false,
    closed: false,
    on(_event: "message", next: (event: { data: unknown }) => void) {
      listener = next;
    },
    start() {
      port.started = true;
    },
    close() {
      port.closed = true;
    },
    emit(data: unknown) {
      listener?.({ data });
    }
  };
  return port;
}

function service() {
  const events: UplinkEvent[] = [];
  let onCommand: ((event: { data: UplinkCommand; ports: MediaPort[] }) => void) | null = null;
  const transports: { url: string; handlers: AudioTransportHandlers; text: AudioClientFrame[]; binary: Uint8Array[]; open: boolean }[] = [];

  createAudioUplinkService(
    {
      on: (_event, listener) => {
        onCommand = listener;
      },
      postMessage: event => events.push(event)
    },
    (url, handlers): AudioTransport => {
      const entry = { url, handlers, text: [] as AudioClientFrame[], binary: [] as Uint8Array[], open: false };
      transports.push(entry);
      return {
        connect: () => {
          entry.open = true;
        },
        sendText: frame => entry.text.push(frame),
        sendBinary: data => entry.binary.push(data),
        close: () => {
          entry.open = false;
        },
        get isOpen() {
          return entry.open;
        },
        bufferedAmount: 0
      };
    }
  );

  return {
    events,
    transports,
    send: (data: UplinkCommand, ports: MediaPort[] = []) => onCommand?.({ data, ports }),
    relay() {
      return transports[transports.length - 1];
    },
    ready(n = 1) {
      this.relay().handlers.onOpen();
      this.relay().handlers.onFrame({ t: "ready", n });
    }
  };
}

describe("audio uplink service", () => {
  it("starts the capture and authenticates with the room's key when main hands it credentials", () => {
    const s = service();

    s.send({ t: "creds", creds: CREDS });
    s.relay().handlers.onOpen();

    expect(s.events).toContainEqual({ t: "capture", on: true });
    expect(s.relay().url).toBe("wss://ytmdesktopplus.com/audio/abcdefgh");
    expect(s.relay().text[0]).toEqual({ t: "pub", r: CREDS.roomId, k: CREDS.hostKey });
  });

  it("publishes what the media host posts on its port once the relay is ready", () => {
    const s = service();
    const media = fakeMediaPort();
    s.send({ t: "port" }, [media]);
    s.send({ t: "creds", creds: CREDS });
    expect(media.started).toBe(true);

    media.emit({ status: { cfg: { sr: 48000, ch: 2, br: 128000 } } });
    s.ready(2);
    media.emit({ packets: [{ t: 0, d: new Uint8Array([1, 2, 3]).buffer }] });

    expect(s.relay().text).toContainEqual({ t: "cfg", codec: "opus", sr: 48000, ch: 2, br: 128000 });
    expect(s.relay().binary).toHaveLength(1);
    expect(s.events).toContainEqual({ t: "update", streaming: true, webListeners: 2 });
  });

  it("turns player state and page status from main into relay frames", () => {
    const s = service();
    s.send({ t: "creds", creds: CREDS });
    s.ready();

    s.send({ t: "state", state: PLAYING });
    s.send({ t: "status", status: { muted: true } });

    const types = s.relay().text.map(frame => frame.t);
    expect(types).toContain("meta");
    expect(types).toContain("anchor");
    expect(s.relay().text.at(-1)).toEqual({ t: "status", s: "muted" });
  });

  it("closes the media port it replaces and reads only the new one", () => {
    const s = service();
    const first = fakeMediaPort();
    const second = fakeMediaPort();
    s.send({ t: "creds", creds: CREDS });
    s.ready();
    s.send({ t: "port" }, [first]);

    s.send({ t: "port" }, [second]);
    second.emit({ packets: [{ t: 0, d: new ArrayBuffer(2) }] });

    expect(first.closed).toBe(true);
    expect(second.started).toBe(true);
    expect(s.relay().binary).toHaveLength(1);
  });

  it("stops the capture and tells main in text when the relay refuses the room", () => {
    const s = service();
    s.send({ t: "creds", creds: CREDS });
    s.ready();

    s.relay().handlers.onFrame({ t: "e", m: "bad key" });

    expect(s.events).toContainEqual({ t: "log", message: "audio publisher refused by the relay", args: ["bad key"] });
    expect(s.events).toContainEqual({ t: "capture", on: false });
    expect(s.events.at(-1)).toEqual({ t: "update", streaming: false, webListeners: 0 });
  });
});

describe("cleanAudioPackets", () => {
  it("keeps well formed packets and drops the rest", () => {
    const good = { t: 12, d: new ArrayBuffer(4) };
    const cleaned = cleanAudioPackets([good, { t: "x", d: new ArrayBuffer(1) }, { t: 1 }, null]);
    expect(cleaned).toHaveLength(1);
    expect(cleaned[0].timestampUs).toBe(12);
    expect(cleaned[0].payload).toBeInstanceOf(Uint8Array);

    expect(cleanAudioPackets("nope")).toEqual([]);
    expect(cleanAudioPackets(undefined)).toEqual([]);
  });
});

function fakeProcess() {
  const posted: { message: UplinkCommand; transfer?: MessagePortMain[] }[] = [];
  const events = new EventEmitter();
  const child = Object.assign(events, {
    postMessage: (message: UplinkCommand, transfer?: MessagePortMain[]) => posted.push({ message, transfer }),
    kill: vi.fn(() => true)
  }) as unknown as UplinkProcess;
  return {
    child,
    posted,
    emit: (event: UplinkEvent) => events.emit("message", event),
    exit: (code = 1) => events.emit("exit", code),
    fail: (type: string) => events.emit("error", type)
  };
}

function proxy() {
  let nowMs = 0;
  const processes: ReturnType<typeof fakeProcess>[] = [];
  const sinks: ((port: MessagePortMain) => void)[] = [];
  const deps: AudioUplinkDeps = {
    fork: vi.fn(() => {
      const created = fakeProcess();
      processes.push(created);
      return created.child;
    }),
    connectMediaHost: vi.fn(send => sinks.push(send)),
    setCapture: vi.fn(),
    onUpdate: vi.fn(),
    log: vi.fn(),
    now: () => nowMs
  };
  return {
    uplink: new AudioUplink(deps),
    deps,
    processes,
    sinks,
    advance(ms: number) {
      nowMs += ms;
    }
  };
}

describe("audio uplink process from main", () => {
  it("forks nothing until a room is hosted, then one process that gets the state it missed", () => {
    const p = proxy();
    p.uplink.updateLocalState(makePlayerState({ trackState: VideoState.Playing }));
    p.uplink.handleCaptureStatus({ muted: true });
    p.uplink.setCredentials(null);
    expect(p.deps.fork).not.toHaveBeenCalled();

    p.uplink.setCredentials(CREDS);
    p.uplink.setCredentials(CREDS);

    expect(p.deps.fork).toHaveBeenCalledTimes(1);
    expect(p.processes[0].posted.map(entry => entry.message.t)).toEqual(["state", "status", "creds", "creds"]);
    expect(p.processes[0].posted[1].message).toEqual({ t: "status", status: { muted: true } });
    expect(p.processes[0].posted[2].message).toEqual({ t: "creds", creds: CREDS });
  });

  it("hands the process its end of every media host pairing", () => {
    const p = proxy();
    p.uplink.setCredentials(CREDS);
    const port = { name: "uplink end" } as unknown as MessagePortMain;

    p.sinks[0](port);

    expect(p.processes[0].posted.at(-1)).toEqual({ message: { t: "port" }, transfer: [port] });
  });

  it("slims player state down to what the stream uses", () => {
    const p = proxy();
    p.uplink.setCredentials(CREDS);

    p.uplink.updateLocalState(makePlayerState({ videoDetails: makeVideoDetails({ id: "dQw4w9WgXcQ" }), volume: 30, playlistId: "PL1" }));

    const sent = p.processes[0].posted.at(-1)?.message;
    expect(sent?.t).toBe("state");
    const state = (sent as { state: Record<string, unknown> }).state;
    expect(Object.keys(state).sort()).toEqual(["adPlaying", "hasFullMetadata", "trackState", "videoDetails", "videoProgress"]);
    expect(Object.keys(state.videoDetails as object).sort()).toEqual(["album", "author", "durationSeconds", "id", "thumbnails", "title"]);
  });

  it("passes capture switches, stream updates and log lines from the process to main", () => {
    const p = proxy();
    p.uplink.setCredentials(CREDS);

    p.processes[0].emit({ t: "capture", on: true });
    p.processes[0].emit({ t: "update", streaming: true, webListeners: 3 });
    p.processes[0].emit({ t: "log", message: "audio capture failed", args: ["boom"] });

    expect(p.deps.setCapture).toHaveBeenCalledWith(true);
    expect(p.deps.onUpdate).toHaveBeenCalledWith({ streaming: true, webListeners: 3 });
    expect(p.deps.log).toHaveBeenCalledWith("audio capture failed", "boom");
  });

  it("restarts a process that exits while hosting and pairs it with the media host again", () => {
    const p = proxy();
    p.uplink.updateLocalState(makePlayerState({ trackState: VideoState.Playing }));
    p.uplink.setCredentials(CREDS);

    p.processes[0].exit(1);

    expect(p.deps.fork).toHaveBeenCalledTimes(2);
    expect(p.deps.connectMediaHost).toHaveBeenCalledTimes(2);
    expect(p.processes[1].posted.map(entry => entry.message.t)).toEqual(["state", "creds"]);
    expect(p.deps.onUpdate).not.toHaveBeenCalled();
  });

  it("logs a fatal error from the process and restarts it on the exit that follows", () => {
    const p = proxy();
    p.uplink.setCredentials(CREDS);

    expect(() => p.processes[0].fail("FatalError")).not.toThrow();
    p.processes[0].exit(134);

    expect(p.deps.log).toHaveBeenCalledWith("Audio uplink process failed", "FatalError");
    expect(p.deps.fork).toHaveBeenCalledTimes(2);
  });

  it("stops the process 5s after hosting ends unless a room is hosted again first", () => {
    vi.useFakeTimers();
    try {
      const p = proxy();
      p.uplink.setCredentials(CREDS);
      p.uplink.setCredentials(null);
      vi.advanceTimersByTime(4_000);
      p.uplink.setCredentials(CREDS);
      vi.advanceTimersByTime(2_000);
      expect(p.processes[0].child.kill).not.toHaveBeenCalled();

      p.uplink.setCredentials(null);
      vi.advanceTimersByTime(5_000);
      expect(p.processes[0].child.kill).toHaveBeenCalledTimes(1);

      p.processes[0].exit(0);
      expect(p.deps.fork).toHaveBeenCalledTimes(1);
      const port = { close: vi.fn() } as unknown as MessagePortMain;
      p.sinks[0](port);
      expect(port.close).toHaveBeenCalled();
      expect(p.processes[0].posted.some(entry => entry.message.t === "port")).toBe(false);

      p.uplink.setCredentials(CREDS);
      expect(p.deps.fork).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets a process that exits after hosting ended stay down until the next room", () => {
    const p = proxy();
    p.uplink.setCredentials(CREDS);
    p.uplink.setCredentials(null);

    p.processes[0].exit(0);
    expect(p.deps.fork).toHaveBeenCalledTimes(1);

    p.uplink.setCredentials(CREDS);
    expect(p.deps.fork).toHaveBeenCalledTimes(2);
  });

  it("gives up after three exits within 30s, stops the capture and reports the stream down once", () => {
    const p = proxy();
    p.uplink.setCredentials(CREDS);

    for (let i = 0; i < 3; i++) {
      p.advance(5000);
      p.processes[i].exit(1);
    }

    expect(p.deps.fork).toHaveBeenCalledTimes(3);
    expect(p.deps.setCapture).toHaveBeenCalledWith(false);
    expect(p.deps.onUpdate).toHaveBeenCalledTimes(1);
    expect(p.deps.onUpdate).toHaveBeenCalledWith({ streaming: false, webListeners: 0 });
    expect(vi.mocked(p.deps.log).mock.calls.filter(([message]) => message.includes("room audio stopped"))).toHaveLength(1);

    p.uplink.setCredentials(CREDS);
    expect(p.deps.fork).toHaveBeenCalledTimes(3);

    p.uplink.setCredentials(null);
    p.uplink.setCredentials(CREDS);
    expect(p.deps.fork).toHaveBeenCalledTimes(4);
  });

  it("keeps restarting when exits are further apart than the window", () => {
    const p = proxy();
    p.uplink.setCredentials(CREDS);

    for (let i = 0; i < 4; i++) {
      p.advance(16_000);
      p.processes[i].exit(1);
    }

    expect(p.deps.fork).toHaveBeenCalledTimes(5);
    expect(p.deps.setCapture).not.toHaveBeenCalled();
  });
});
