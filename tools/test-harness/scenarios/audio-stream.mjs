// Hosts a live Listen Along room in the app and verifies the audio channel
// end to end: the capture pipeline encodes, the publisher authenticates
// against the production relay, an in-scenario browser bot subscribes to
// /audio/<room> and receives config, metadata and a monotonic batch stream,
// the local volume stays off the wire and the stream survives a track change.
// Local use, not suited to CI runners: production relay plus live YTM.

import WebSocket from "ws";
import { hooksReadyStep, playbackFixture, roomIntegrationsFixture } from "./lib.mjs";

export const inspectMain = true;

export const fixture = {
  playback: playbackFixture(),
  integrations: roomIntegrationsFixture(),
  addons: {
    states: { rooms: { enabled: true } },
    settings: { rooms: { displayName: "Harness Host", audioStreamEnabled: true } }
  }
};

const VIDEO_ID = "dQw4w9WgXcQ";
const NEXT_VIDEO_ID = "9bZkp7q19f0";
const BLOCK_MS = 3000;
const MAX_ARRIVAL_GAP_MS = 300;
const SETTINGS_WINDOW = /windows\/settings\//;
const ROOM_WINDOW = /windows\/room\//;

export default async function audioStream(ctx) {
  const bot = { socket: null, frames: [], batches: [], arrivals: [] };

  try {
    await hooksReadyStep(ctx);

    await ctx.step(
      "a track is playing",
      async () => {
        for (let attempt = 1; ; attempt++) {
          await ctx.evalYtm(`document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: "${VIDEO_ID}" } } } }))`);
          try {
            await ctx.waitYtm(
              `document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi?.getPlayerState?.() ?? null`,
              state => state === 1,
              12000
            );
            return;
          } catch (error) {
            if (attempt === 9) throw error;
            ctx.emit("probe", { navigateRetry: attempt });
          }
        }
      },
      125000
    );

    await ctx.step(
      "room window opens from settings",
      async () => {
        await ctx.evalMain("window.ytmd.openSettingsWindow()");
        await ctx.waitTarget(SETTINGS_WINDOW, 15000);
        await ctx.waitOnTarget(SETTINGS_WINDOW, "typeof window.ytmd?.openRoomWindow", kind => kind === "function", 15000);
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
        await ctx.evalOnTarget(ROOM_WINDOW, `[...document.querySelectorAll("button")].find(x => x.textContent.trim() === "Start a room").click()`);
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

    await ctx.step("capture pipeline is running", () => ctx.waitYtm("!!window.__ytmdAudioStream?.node", running => running === true, 30000), 35000);

    await ctx.step(
      "bot receives config, metadata and a monotonic stream",
      () =>
        new Promise((resolve, reject) => {
          const socket = new WebSocket(`wss://ytmdesktopplus.com/audio/${roomId}`);
          bot.socket = socket;
          const timer = setTimeout(() => reject(new Error(`bot saw ${bot.frames.length} frames, ${bot.batches.length} batches`)), 60000);
          let done = false;
          const maybeDone = () => {
            if (done) return;
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
            done = true;
            clearTimeout(timer);
            resolve();
          };
          socket.on("message", (data, isBinary) => {
            if (isBinary) {
              bot.arrivals.push(Date.now());
              const chunk = /** @type {Buffer} */ (data);
              bot.batches.push(new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(4));
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
      `the stream keeps flowing while main is blocked for ${BLOCK_MS}ms`,
      async () => {
        await new Promise(resolve => setTimeout(resolve, 2000));
        const blockedAt = Date.now();
        await ctx.evalMainProcess(`(() => { const end = Date.now() + ${BLOCK_MS}; while (Date.now() < end); return true; })()`);
        const releasedAt = Date.now();
        await new Promise(resolve => setTimeout(resolve, 2000));

        const from = blockedAt - 1000;
        const to = releasedAt + 1000;
        const points = [from, ...bot.arrivals.filter(at => at > from && at < to), to];
        const gaps = points.slice(1).map((at, index) => at - points[index]);
        const maxGapMs = Math.max(...gaps);
        ctx.emit("probe", {
          blockedMs: releasedAt - blockedAt,
          batchesInWindow: points.length - 2,
          maxArrivalGapMs: maxGapMs,
          gapsOver300ms: gaps.filter(gap => gap > MAX_ARRIVAL_GAP_MS).length
        });
        if (releasedAt - blockedAt < BLOCK_MS) throw new Error(`main was blocked for only ${releasedAt - blockedAt}ms`);
        if (maxGapMs > MAX_ARRIVAL_GAP_MS) throw new Error(`no batch reached the listener for ${maxGapMs}ms while main was blocked`);
      },
      30000
    );

    await ctx.step(
      "the stream carries on across a track change",
      async () => {
        const before = bot.batches.length;
        const firstMeta = bot.frames.filter(frame => frame.t === "meta").at(-1);

        await ctx.evalYtm(
          `document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: "${NEXT_VIDEO_ID}" } } } }))`
        );

        const deadline = Date.now() + 60000;
        let crossed = null;
        while (Date.now() < deadline) {
          crossed = bot.frames.find(frame => frame.t === "meta" && frame.v === NEXT_VIDEO_ID) ?? null;
          if (crossed) break;
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!crossed) throw new Error(`no meta for ${NEXT_VIDEO_ID}; saw ${JSON.stringify(bot.frames.filter(f => f.t === "meta").map(f => f.v))}`);

        const atBoundary = bot.batches.length;
        const settle = Date.now() + 20000;
        while (Date.now() < settle && bot.batches.length < atBoundary + 8) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }

        const after = bot.batches.length - atBoundary;
        ctx.emit("probe", { fromVideoId: firstMeta?.v ?? null, toVideoId: crossed.v, batchesBefore: before, batchesAfter: after });
        if (after < 8) throw new Error(`only ${after} batches after the track change; the stream stalled`);

        // A gap is legitimate here, the publisher marks it; going backwards is not.
        const tail = bot.batches.slice(atBoundary);
        for (let i = 1; i < tail.length; i++) {
          if (tail[i] <= tail[i - 1]) throw new Error(`batch sequence not monotonic across the change: ${tail.join(",")}`);
        }

        const running = await ctx.evalYtm("!!window.__ytmdAudioStream?.node");
        if (running !== true) throw new Error("host capture node went away at the track change");
      },
      90000
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
      "a muted host keeps streaming to its listener",
      async () => {
        const before = bot.batches.length;
        await ctx.evalYtm(`document.querySelector("video").muted = true`);
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && bot.batches.length < before + 20) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        const elementMuted = await ctx.evalYtm(`window.__ytmdAudioStream.mutedDesc.get.call(document.querySelector("video"))`);
        ctx.emit("probe", { batchesAfterMute: bot.batches.length - before, elementMuted });
        if (bot.batches.length < before + 20) throw new Error(`the stream stalled after the host muted: ${bot.batches.length - before} batches`);
        if (bot.frames.some(frame => frame.t === "status" && frame.s === "muted")) throw new Error("the listener was told the host muted");
        if (elementMuted !== false) throw new Error("the element itself was muted, which silences the broadcast");
      },
      15000
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
