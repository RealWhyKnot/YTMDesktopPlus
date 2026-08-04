// Hosts a live Listen Along room in the app and verifies the audio channel
// end to end: the capture pipeline encodes, the publisher authenticates
// against the production relay, an in-scenario browser bot subscribes to
// /audio/<room> and receives config, metadata and a monotonic batch stream,
// the local volume stays off the wire, and mute reaches the bot as a status.
// Local use, not suited to CI runners: production relay plus live YTM.

import WebSocket from "ws";

export const fixture = {
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false,
    loudnessNormalization: false
  },
  integrations: {
    companionServerEnabled: false,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false,
    listenAlongEnabled: false,
    listenAlongHost: null,
    listenAlongHostPort: 9863,
    listenAlongToken: null,
    listenAlongRoomsEnabled: true,
    listenAlongDisplayName: "Harness Host",
    listenAlongAudioStreamEnabled: true
  }
};

const VIDEO_ID = "dQw4w9WgXcQ";
const SETTINGS_WINDOW = /windows\/settings\//;
const ROOM_WINDOW = /windows\/room\//;

export default async function audioStream(ctx) {
  const bot = { socket: null, frames: [], batches: [] };

  try {
    await ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);

    await ctx.step(
      "a track is playing",
      async () => {
        await ctx.evalYtm(
          `document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: "${VIDEO_ID}" } } } }))`
        );
        await ctx.waitYtm(
          `document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerState?.() ?? null`,
          state => state === 1,
          120000
        );
      },
      125000
    );

    await ctx.step(
      "room window opens from settings",
      async () => {
        await ctx.evalMain("window.ytmd.openSettingsWindow()");
        await ctx.waitTarget(SETTINGS_WINDOW, 15000);
        await ctx.evalOnTarget(SETTINGS_WINDOW, "window.ytmd.openRoomWindow()");
        await ctx.waitTarget(ROOM_WINDOW, 15000);
      },
      40000
    );

    let roomId = null;
    await ctx.step(
      "app hosts a room",
      async () => {
        await ctx.waitOnTarget(ROOM_WINDOW, "document.querySelectorAll('input').length", count => Number(count) >= 2, 20000);
        await ctx.evalOnTarget(
          ROOM_WINDOW,
          `[...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Start a room").click()`
        );
        await ctx.waitOnTarget(
          ROOM_WINDOW,
          "document.querySelector('.room-code')?.textContent ?? null",
          code => typeof code === "string" && /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/.test(code.trim()),
          30000
        );
        roomId = (await ctx.evalOnTarget(ROOM_WINDOW, "document.querySelector('.room-code').textContent")).trim();
        ctx.emit("probe", { roomId });
      },
      60000
    );

    await ctx.step(
      "capture pipeline is running",
      () => ctx.waitYtm("window.__ytmdAudioStream?.batchesSent ?? 0", sent => Number(sent) > 0, 30000),
      35000
    );

    await ctx.step(
      "bot receives config, metadata and a monotonic stream",
      () =>
        new Promise((resolve, reject) => {
          const socket = new WebSocket(`wss://ytmdesktopplus.com/audio/${roomId}`);
          bot.socket = socket;
          const timer = setTimeout(() => reject(new Error(`bot saw ${bot.frames.length} frames, ${bot.batches.length} batches`)), 60000);
          const maybeDone = () => {
            const types = bot.frames.map(frame => frame.t);
            if (!types.includes("cfg") || !types.includes("meta") || bot.batches.length < 8) return;
            for (let i = 1; i < bot.batches.length; i++) {
              if (bot.batches[i] <= bot.batches[i - 1]) {
                clearTimeout(timer);
                reject(new Error(`batch sequence not monotonic: ${bot.batches.join(",")}`));
                return;
              }
            }
            const cfg = bot.frames.find(frame => frame.t === "cfg");
            const meta = bot.frames.find(frame => frame.t === "meta");
            ctx.emit("probe", { cfg, meta, batches: bot.batches.length });
            clearTimeout(timer);
            resolve();
          };
          socket.on("message", (data, isBinary) => {
            if (isBinary) {
              bot.batches.push(new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(4));
            } else {
              bot.frames.push(JSON.parse(data.toString("utf8")));
            }
            maybeDone();
          });
          socket.on("open", () => socket.send(JSON.stringify({ t: "sub", r: roomId })));
          socket.on("error", reject);
        }),
      65000
    );

    await ctx.step(
      "local volume stays off the wire",
      async () => {
        const readback = JSON.parse(
          await ctx.evalYtm(`(() => {
            const video = document.querySelector("video");
            video.volume = 0.1;
            const state = window.__ytmdAudioStream;
            return JSON.stringify({ reported: video.volume, applied: state.nativeDesc.get.call(video) });
          })()`)
        );
        ctx.emit("probe", readback);
        if (Math.abs(readback.reported - 0.1) > 0.001) throw new Error(`element reports ${readback.reported}`);
        if (Math.abs(readback.applied - 1) > 0.001) throw new Error(`element applies ${readback.applied}, the slider is on the wire`);
      },
      15000
    );

    await ctx.step(
      "mute reaches the bot as a status",
      async () => {
        await ctx.evalYtm(`document.querySelector("video").muted = true`);
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline) {
          if (bot.frames.some(frame => frame.t === "status" && frame.s === "muted")) return;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        throw new Error(`no muted status: ${JSON.stringify(bot.frames.filter(frame => frame.t === "status"))}`);
      },
      20000
    );

    // YTMD_TEST_HOLD=<seconds> keeps the hosted room streaming after the
    // assertions, for pointing a real browser at the web player.
    const holdSeconds = Number(process.env.YTMD_TEST_HOLD ?? 0);
    if (holdSeconds > 0) {
      await ctx.evalYtm(`document.querySelector("video").muted = false`);
      await ctx.step(
        `hold the room open for ${holdSeconds}s`,
        () => new Promise(resolve => setTimeout(resolve, holdSeconds * 1000)),
        holdSeconds * 1000 + 5000
      );
    }
  } finally {
    bot.socket?.close();
  }
}
