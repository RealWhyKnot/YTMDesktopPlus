import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import DiscordPresence, {
  connectionRetryDelay,
  getHighestResThumbnail,
  type PresenceButtonsProvider,
  type RemoteTrackActivity
} from "../src/main/integrations/discord-presence";
import { getIPCPaths } from "../src/main/integrations/discord-presence/minimal-discord-client";
import IPCClient, { OPCode } from "../src/main/integrations/discord-presence/minimal-discord-client/ipc";
import { VideoState, type PlayerState } from "../src/main/player-state-store";
import { makePlayerState, makeVideoDetails } from "./helpers/fake-addon-context";

// The buttons discord shows on the presence. Discord renders at most two
// buttons and only http(s) urls; anything else silently drops the whole
// activity frame, so both limits are part of the contract here.

type Buttons = { label: string; url: string }[] | undefined;

function buildButtons(providers: PresenceButtonsProvider[]): Buttons {
  const presence = new DiscordPresence();
  for (const provider of providers) {
    presence.registerButtonsProvider(provider);
  }
  return (presence as unknown as { buildButtons(): Buttons }).buildButtons();
}

describe("buildButtons", () => {
  it("shows nothing without providers or when providers decline", () => {
    expect(buildButtons([])).toBeUndefined();
    expect(buildButtons([() => undefined, () => []])).toBeUndefined();
  });

  it("collects what a provider offers", () => {
    const buttons = buildButtons([() => [{ label: "Listen Along", url: "https://ytmdesktopplus.com/r/abcdefgh" }]]);
    expect(buttons).toEqual([{ label: "Listen Along", url: "https://ytmdesktopplus.com/r/abcdefgh" }]);
  });

  it("drops non-http urls and caps the result at two buttons", () => {
    const buttons = buildButtons([
      () => [
        { label: "Bad", url: "ytmdplus://room/abcdefgh" },
        { label: "One", url: "https://ytmdesktopplus.com/r/abcdefgh" },
        { label: "Two", url: "https://ytmdesktopplus.com/r/ijklmnop" },
        { label: "Three", url: "https://ytmdesktopplus.com/" }
      ]
    ]);
    expect(buttons).toEqual([
      { label: "One", url: "https://ytmdesktopplus.com/r/abcdefgh" },
      { label: "Two", url: "https://ytmdesktopplus.com/r/ijklmnop" }
    ]);
  });

  it("contains a throwing provider and keeps the rest", () => {
    const buttons = buildButtons([
      () => {
        throw new Error("provider blew up");
      },
      () => [{ label: "Listen Along", url: "https://ytmdesktopplus.com/r/abcdefgh" }]
    ]);
    expect(buttons).toEqual([{ label: "Listen Along", url: "https://ytmdesktopplus.com/r/abcdefgh" }]);
  });

  it("unregisters a provider through the returned handle", () => {
    const presence = new DiscordPresence();
    const unsubscribe = presence.registerButtonsProvider(() => [{ label: "One", url: "https://ytmdesktopplus.com/" }]);
    unsubscribe();
    const buttons = (presence as unknown as { buildButtons(): Buttons }).buildButtons();
    expect(buttons).toBeUndefined();
  });
});

function playingState(): PlayerState {
  return makePlayerState({
    videoDetails: makeVideoDetails({
      album: "Album",
      albumId: "MPREb_album",
      author: "Author",
      channelId: "UCchannel",
      durationSeconds: 200,
      thumbnails: [{ url: "https://example.invalid/art.jpg", width: 60, height: 60 }],
      title: "Title",
      id: "videoid1234"
    }),
    videoProgress: 12,
    trackState: VideoState.Playing,
    hasFullMetadata: true
  });
}

function pausedState(): PlayerState {
  return { ...playingState(), trackState: VideoState.Paused };
}

type ActivityPayload = { details?: string; timestamps?: { start?: number; end?: number }; assets?: { small_text?: string; large_image?: string } };

type PresenceHarness = {
  presence: DiscordPresence;
  calls: { set: number; clear: number };
  activities: ActivityPayload[];
  settings: { listenAlongRoomsEnabled: boolean; discordPresenceHideOnPause: boolean };
  stateChanged(state: PlayerState): void;
};

function makePresence(settings: Partial<PresenceHarness["settings"]> = {}): PresenceHarness {
  const calls = { set: 0, clear: 0 };
  const activities: ActivityPayload[] = [];
  const resolved = { listenAlongRoomsEnabled: false, discordPresenceHideOnPause: false, ...settings };
  const presence = new DiscordPresence();
  presence.provide({ get: () => resolved } as never, { get: (): null => null } as never);
  Object.assign(presence, {
    ready: true,
    discordClient: {
      setActivity: (activity: ActivityPayload) => {
        calls.set++;
        activities.push(activity);
      },
      clearActivity: () => calls.clear++
    }
  });
  return {
    presence,
    calls,
    activities,
    settings: resolved,
    stateChanged: state => (presence as unknown as { playerStateChanged(state: PlayerState): void }).playerStateChanged(state)
  };
}

describe("activity updates", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // A room opening at launch refreshes the activity before any track has
  // loaded. That refresh must not become the last one of the session.
  it("still reports playback after a refresh with no track loaded", () => {
    vi.useFakeTimers();
    const calls = { set: 0, clear: 0 };
    const presence = new DiscordPresence();
    presence.provide({ get: () => ({ listenAlongRoomsEnabled: false }) } as never, { get: (): null => null } as never);
    Object.assign(presence, {
      ready: true,
      discordClient: {
        setActivity: () => calls.set++,
        clearActivity: () => calls.clear++
      }
    });

    presence.refreshActivity();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 0, clear: 1 });

    (presence as unknown as { playerStateChanged(state: PlayerState): void }).playerStateChanged(playingState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 1, clear: 1 });
  });

  it("keeps the paused badge and clears after 30 seconds when hide-on-pause is off", () => {
    vi.useFakeTimers();
    const { calls, stateChanged } = makePresence();

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    stateChanged(pausedState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 2, clear: 0 });

    vi.advanceTimersByTime(30_000);
    expect(calls.clear).toBe(1);
  });

  it("clears on pause when hide-on-pause is on", () => {
    vi.useFakeTimers();
    const { calls, stateChanged } = makePresence({ discordPresenceHideOnPause: true });

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 1, clear: 0 });

    stateChanged(pausedState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 1, clear: 1 });
  });

  it("restores the activity on resume after a hidden pause", () => {
    vi.useFakeTimers();
    const { calls, stateChanged } = makePresence({ discordPresenceHideOnPause: true });

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    stateChanged(pausedState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 1, clear: 1 });

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 2, clear: 1 });
  });

  it("clears through refreshActivity when the setting turns on while paused", () => {
    vi.useFakeTimers();
    const { presence, calls, settings, stateChanged } = makePresence();

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    stateChanged(pausedState());
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 2, clear: 0 });

    settings.discordPresenceHideOnPause = true;
    presence.refreshActivity();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 2, clear: 1 });
  });
});

// A remote track (playback outside this app) stands in wherever the activity
// used to clear, and never displaces a local track.
describe("remote activity provider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const remoteTrack: RemoteTrackActivity = {
    title: "Remote Title",
    author: "Remote Author",
    videoId: "remoteid123",
    thumbnailUrl: "https://example.invalid/remote.jpg",
    startedAtEpochMs: 1_000_000
  };

  it("stands in when no track is loaded, with a start-only timestamp", () => {
    vi.useFakeTimers();
    const { presence, calls, activities } = makePresence();
    presence.registerRemoteActivityProvider(() => remoteTrack);

    presence.refreshActivity();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 1, clear: 0 });
    expect(activities[0].details).toBe("Remote Title");
    expect(activities[0].timestamps).toEqual({ start: 1_000_000 });
    expect(activities[0].assets?.small_text).toBe("Playing on another device");
    expect(activities[0].assets?.large_image).toBe("https://example.invalid/remote.jpg");
  });

  it("never displaces a local track", () => {
    vi.useFakeTimers();
    const { presence, activities, stateChanged } = makePresence();
    presence.registerRemoteActivityProvider(() => remoteTrack);

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    expect(activities.at(-1)?.details).toBe("Title");
  });

  it("stands in on a hidden pause and on the 30s pause clear", () => {
    vi.useFakeTimers();
    const hidden = makePresence({ discordPresenceHideOnPause: true });
    hidden.presence.registerRemoteActivityProvider(() => remoteTrack);
    hidden.stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    hidden.stateChanged(pausedState());
    vi.advanceTimersByTime(1000);
    expect(hidden.calls.clear).toBe(0);
    expect(hidden.activities.at(-1)?.details).toBe("Remote Title");

    const visible = makePresence();
    visible.presence.registerRemoteActivityProvider(() => remoteTrack);
    visible.stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    visible.stateChanged(pausedState());
    vi.advanceTimersByTime(31_000);
    expect(visible.calls.clear).toBe(0);
    expect(visible.activities.at(-1)?.details).toBe("Remote Title");
  });

  it("does not revive a stale local track after the view reports no video", () => {
    vi.useFakeTimers();
    const { presence, activities, stateChanged } = makePresence();
    presence.registerRemoteActivityProvider(() => remoteTrack);

    stateChanged(playingState());
    vi.advanceTimersByTime(1000);
    stateChanged({ ...playingState(), videoDetails: null } as PlayerState);
    expect(activities.at(-1)?.details).toBe("Remote Title");

    presence.refreshActivity();
    vi.advanceTimersByTime(1000);
    expect(activities.at(-1)?.details).toBe("Remote Title");
  });

  it("clears when providers throw or are unregistered", () => {
    vi.useFakeTimers();
    const { presence, calls } = makePresence();
    presence.registerRemoteActivityProvider(() => {
      throw new Error("provider blew up");
    });
    presence.refreshActivity();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 0, clear: 1 });

    const unsubscribe = presence.registerRemoteActivityProvider(() => remoteTrack);
    unsubscribe();
    presence.refreshActivity();
    vi.advanceTimersByTime(1000);
    expect(calls).toEqual({ set: 0, clear: 2 });
  });
});

describe("tracks without artwork", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("picks no thumbnail from an empty or missing list", () => {
    expect(getHighestResThumbnail([])).toBeUndefined();
    expect(getHighestResThumbnail(undefined)).toBeUndefined();
    expect(getHighestResThumbnail(null)).toBeUndefined();
  });

  it("picks the largest thumbnail", () => {
    expect(
      getHighestResThumbnail([
        { url: "https://example.invalid/small.jpg", width: 60, height: 60 },
        { url: "https://example.invalid/big.jpg", width: 544, height: 544 },
        { url: "https://example.invalid/mid.jpg", width: 120, height: 120 }
      ])
    ).toBe("https://example.invalid/big.jpg");
  });

  it("shows the app icon instead of throwing from the debounce timer", () => {
    vi.useFakeTimers();
    const { calls, activities, stateChanged } = makePresence();
    const state = playingState();
    stateChanged({ ...state, videoDetails: { ...state.videoDetails, thumbnails: [] } });

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
    expect(calls.set).toBe(1);
    expect(activities[0].assets?.large_image).toBe("icon");
  });

  it("keeps the debounce timer from throwing when the client does", () => {
    vi.useFakeTimers();
    const { presence, stateChanged } = makePresence();
    Object.assign(presence, {
      discordClient: {
        setActivity: () => {
          throw new Error("socket gone");
        },
        clearActivity: () => {}
      }
    });
    stateChanged(playingState());

    expect(() => vi.advanceTimersByTime(1000)).not.toThrow();
  });
});

describe("connection retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function retryingPresence() {
    const memory: Record<string, unknown> = {};
    const connect = vi.fn(() => Promise.reject(new Error("no discord")));
    const presence = new DiscordPresence();
    presence.provide({ get: () => ({}) } as never, { set: (key: string, value: unknown) => (memory[key] = value) } as never);
    Object.assign(presence, { enabled: true, discordClient: { connect } });
    const retry = () => (presence as unknown as { retryDiscordConnection(): void }).retryDiscordConnection();
    return { presence, connect, memory, retry };
  }

  it("backs off exponentially up to a minute", () => {
    expect([1, 2, 3, 4, 5, 6, 50].map(connectionRetryDelay)).toEqual([5000, 10000, 20000, 40000, 60000, 60000, 60000]);
  });

  it("keeps trying past thirty attempts while enabled", async () => {
    vi.useFakeTimers();
    const { connect, memory, retry } = retryingPresence();

    retry();
    await vi.advanceTimersByTimeAsync(5000 + 10000 + 20000 + 40000);
    expect(connect).toHaveBeenCalledTimes(4);

    await vi.advanceTimersByTimeAsync(40 * 60 * 1000);
    expect(connect.mock.calls.length).toBeGreaterThan(30);
    expect(memory.discordPresenceConnectionFailed).toBe(true);

    const before = connect.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 1000);
    expect(connect.mock.calls.length).toBe(before + 1);
  });

  it("stops retrying once disabled", async () => {
    vi.useFakeTimers();
    const { presence, connect, retry } = retryingPresence();
    Object.assign(presence, { discordClient: { connect, destroy: () => {} } });

    retry();
    await vi.advanceTimersByTimeAsync(5000);
    expect(connect).toHaveBeenCalledTimes(1);

    presence.disable();
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(connect).toHaveBeenCalledTimes(1);
  });
});

describe("ipc frames", () => {
  function frame(op: number, payload: unknown): Buffer {
    const json = Buffer.from(JSON.stringify(payload), "utf-8");
    const header = Buffer.alloc(8);
    header.writeInt32LE(op, 0);
    header.writeInt32LE(json.length, 4);
    return Buffer.concat([header, json]);
  }

  function client() {
    const ipc = new IPCClient();
    const received: [number, unknown][] = [];
    ipc.on("data", (op: number, json: unknown) => received.push([op, json]));
    const socket = (ipc as unknown as { socket: Socket }).socket;
    return { ipc, received, feed: (chunk: Buffer) => socket.emit("data", chunk), socket };
  }

  it("reassembles a frame split across reads, including inside the header and a multi-byte character", () => {
    const { ipc, received, feed } = client();
    const whole = frame(OPCode.FRAME, { evt: "READY", data: { user: "Zoë" } });

    feed(whole.subarray(0, 3));
    feed(whole.subarray(3, 11));
    expect(received).toEqual([]);
    for (let index = 11; index < whole.length; index++) feed(whole.subarray(index, index + 1));

    expect(received).toEqual([[OPCode.FRAME, { evt: "READY", data: { user: "Zoë" } }]]);
    ipc.destroy();
  });

  it("splits frames that arrive joined in one read", () => {
    const { ipc, received, feed } = client();
    const first = frame(OPCode.FRAME, { evt: "READY" });
    const second = frame(OPCode.PING, { n: 1 });
    const third = frame(OPCode.FRAME, { evt: "ERROR" });

    feed(Buffer.concat([first, second, third.subarray(0, 5)]));
    expect(received).toEqual([
      [OPCode.FRAME, { evt: "READY" }],
      [OPCode.PING, { n: 1 }]
    ]);

    feed(third.subarray(5));
    expect(received.at(-1)).toEqual([OPCode.FRAME, { evt: "ERROR" }]);
    ipc.destroy();
  });

  it("skips a frame with a bad body and keeps reading the next one", () => {
    const { ipc, received, feed } = client();
    const header = Buffer.alloc(8);
    header.writeInt32LE(OPCode.FRAME, 0);
    header.writeInt32LE(3, 4);

    feed(Buffer.concat([header, Buffer.from("{{{"), frame(OPCode.FRAME, { ok: true })]));

    expect(received).toEqual([[OPCode.FRAME, { ok: true }]]);
    ipc.destroy();
  });

  it("does not throw a socket error nobody listens for", () => {
    const { ipc, socket } = client();
    ipc.removeAllListeners();

    expect(() => socket.emit("error", new Error("EPIPE"))).not.toThrow();
    ipc.destroy();
  });
});

// The socket a flatpak discord opens lands under its own runtime dir, not the
// shared one, and reaching it at all depends on the matching --filesystem in
// forge.config.ts. Nothing else in the suite would notice it going missing.
// The posix branch is unreachable on the platform this repo is developed on,
// hence the override rather than a skip.
function withPlatform<T>(platform: string, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    return run();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}

describe("getIPCPaths", () => {
  let runtimeDir = "";
  const originalRuntimeDir = process.env.XDG_RUNTIME_DIR;

  function runtimeDirContaining(...subdirectories: string[]): string {
    runtimeDir = mkdtempSync(path.join(tmpdir(), "ytmd-ipc-"));
    for (const subdirectory of subdirectories) {
      mkdirSync(path.join(runtimeDir, subdirectory), { recursive: true });
    }
    process.env.XDG_RUNTIME_DIR = runtimeDir;
    return runtimeDir;
  }

  afterEach(() => {
    if (originalRuntimeDir === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = originalRuntimeDir;
    if (runtimeDir) rmSync(runtimeDir, { recursive: true, force: true });
    runtimeDir = "";
  });

  it("reaches a flatpak discord and skips layouts that are not installed", () => {
    const dir = runtimeDirContaining(path.join("app", "com.discordapp.Discord"));

    const paths = withPlatform("linux", getIPCPaths);

    expect(paths.slice(0, 2)).toEqual([`${dir}/discord-ipc-0`, `${dir}/app/com.discordapp.Discord/discord-ipc-0`]);
    expect(paths.some(candidate => candidate.includes("snap.discord"))).toBe(false);
    expect(paths).toHaveLength(20);
  });

  it("reaches a snap discord", () => {
    const dir = runtimeDirContaining("snap.discord");

    expect(withPlatform("linux", getIPCPaths).slice(0, 2)).toEqual([`${dir}/discord-ipc-0`, `${dir}/snap.discord/discord-ipc-0`]);
  });

  it("falls back to the shared runtime dir alone", () => {
    const dir = runtimeDirContaining();

    expect(withPlatform("linux", getIPCPaths)).toEqual(Array.from({ length: 10 }, (_unused, id) => `${dir}/discord-ipc-${id}`));
  });

  it("uses named pipes on windows", () => {
    expect(withPlatform("win32", getIPCPaths)).toEqual(Array.from({ length: 10 }, (_unused, id) => String.raw`\\?\pipe\discord-ipc-` + id));
  });
});

describe("test clients", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it.each([
    ["YTMD_TEST", "1"],
    ["YTMD_TEST_PROFILE", String.raw`C:\profiles\smoke`]
  ])("offer no discord socket when %s is set", (variable, value) => {
    vi.stubEnv(variable, value);

    expect(withPlatform("win32", getIPCPaths)).toEqual([]);
    expect(withPlatform("linux", getIPCPaths)).toEqual([]);
  });

  it("never open a socket with presence enabled", async () => {
    vi.useFakeTimers();
    vi.stubEnv("YTMD_TEST_PROFILE", String.raw`C:\profiles\smoke`);
    const connect = vi.spyOn(Socket.prototype, "connect");
    const presence = new DiscordPresence();
    presence.provide({ get: () => ({}) } as never, { set: vi.fn() } as never);

    presence.enable();
    await vi.advanceTimersByTimeAsync(15_000);
    presence.disable();

    expect(connect).not.toHaveBeenCalled();
  });
});
