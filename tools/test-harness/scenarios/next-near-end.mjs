import { writeFileSync } from "node:fs";
import path from "node:path";
import { evalOnTarget } from "../cdp.mjs";
import { hooksReadyStep, obtainCompanionToken, playbackFixture } from "./lib.mjs";

export const needsCompanion = true;
export const fixture = {
  playback: playbackFixture({ preventIdlePause: true }),
  addons: { states: { blend: { enabled: false } } },
  integrations: {
    companionServerEnabled: true,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false
  }
};

const VIDEO_ID = "dQw4w9WgXcQ";
const TRIALS = 10;
const SEEK_BEFORE_END_S = 12;
const FIRE_BEFORE_END_S = 5.12;
const WINDOW_MS = 10000;
const YTM_PAGE = /music\.youtube\.com/;

const PAGE = `(window.__ytmdNearEnd = window.__ytmdNearEnd || (() => {
  const api = () => document.querySelector("ytmusic-app-layout>ytmusic-player-bar")?.playerApi;
  const read = () => {
    const player = api();
    if (!player) return null;
    return {
      videoId: player.getVideoData()?.video_id ?? null,
      cur: player.getCurrentTime(),
      len: Number(player.getPlayerResponse()?.videoDetails?.lengthSeconds) || 0,
      dur: player.getDuration(),
      state: player.getPlayerState(),
      ad: window.__YTMD_HOOK__?.ytmStore?.getState()?.player?.adPlaying === true
    };
  };
  const queuedNext = () => {
    const queue = window.__ytmdProjectQueue?.(window.__YTMD_HOOK__?.ytmStore?.getState()?.queue);
    const items = queue ? [...queue.items, ...queue.automixItems].filter(Boolean) : [];
    const index = items.findIndex(item => item.selected);
    const next = index >= 0 ? items[index + 1] : null;
    return next ? [next.videoId, ...(next.counterparts ?? []).map(item => item.videoId)] : null;
  };
  const self = { read, samples: [] };
  self.fireAt = remainingS =>
    new Promise((resolve, reject) => {
      const deadline = performance.now() + 30000;
      const tick = () => {
        const now = read();
        if (now && now.len && now.cur >= now.len - remainingS) {
          const t0 = performance.now();
          const samples = [];
          self.samples = samples;
          const timer = setInterval(() => {
            samples.push({ t: Math.round(performance.now() - t0), ...read() });
            if (performance.now() - t0 >= ${WINDOW_MS}) clearInterval(timer);
          }, 100);
          resolve({ ...now, queuedNext: queuedNext() });
        } else if (performance.now() > deadline) {
          reject(new Error("fire point not reached: " + JSON.stringify(now)));
        } else {
          setTimeout(tick, 5);
        }
      };
      tick();
    });
  return self;
})())`;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = value => (value === null ? null : Math.round(value * 100) / 100);

async function waitPlaying(ctx, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await ctx.evalYtm(`${PAGE}.read()`);
    if (last && last.state === 1 && !last.ad && last.cur >= 2 && last.len > SEEK_BEFORE_END_S + 5) return last;
    await sleep(500);
  }
  throw new Error(`no clean playback within ${timeoutMs}ms: ${JSON.stringify(last)}`);
}

function classify(pre, samples) {
  const seen = samples.filter(sample => sample.videoId);
  const last = seen.at(-1);
  const base = {
    videoId: pre.videoId,
    len: pre.len,
    firedAt: round(pre.cur),
    appended: Math.abs(pre.dur - pre.len) > 1,
    queuedNext: pre.queuedNext?.[0] ?? null
  };
  if (seen.some(sample => sample.ad)) return { ...base, outcome: "ad" };
  if (!last) return { ...base, outcome: "no-samples" };
  if (last.videoId === pre.videoId) return { ...base, outcome: last.cur < pre.cur ? "restarted-same" : "no-advance", lastCur: round(last.cur) };

  const changed = seen.find(sample => sample.videoId === last.videoId);
  const firstPlaying = seen.find(sample => sample.videoId === last.videoId && sample.state === 1);
  const startedAt = firstPlaying ? round(last.cur - (last.t - firstPlaying.t) / 1000) : null;
  const result = { ...base, newVideoId: last.videoId, changedAtMs: changed.t, startedAt };
  if (changed.t > 3500) return { ...result, outcome: "natural-end" };
  if (pre.queuedNext && !pre.queuedNext.includes(last.videoId)) return { ...result, outcome: "wrong-track" };
  if (startedAt === null) return { ...result, outcome: "not-playing" };
  return { ...result, outcome: startedAt > 2 ? "late-start" : "clean" };
}

export default async function nextNearEnd(ctx) {
  let token;
  await ctx.step(
    "obtain token",
    async () => {
      token = await obtainCompanionToken(ctx);
    },
    90000
  );

  await hooksReadyStep(ctx);

  await ctx.step(
    "playback started",
    async () => {
      let playing = null;
      for (let attempt = 1; attempt <= 6; attempt++) {
        const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "changeVideo", data: { videoId: VIDEO_ID } } });
        if (res.status !== 204) throw new Error(`changeVideo returned ${res.status}`);
        playing = await waitPlaying(ctx, 12000).catch(() => null);
        if (playing?.videoId === VIDEO_ID) return;
        ctx.emit("probe-change-video-retry", { attempt, playing: playing?.videoId ?? null });
      }
      throw new Error(`${VIDEO_ID} never started: ${JSON.stringify(playing)}`);
    },
    100000
  );

  await ctx.step(
    "first skip of the session is out of the count",
    async () => {
      await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "next" } });
      const playing = await waitPlaying(ctx, 15000).catch(() => null);
      ctx.emit("probe-first-skip", { playing: playing?.videoId ?? null });
      if (!playing) await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "play" } });
    },
    30000
  );

  const results = [];
  for (let trial = 1; trial <= TRIALS; trial++) {
    await ctx.step(
      `next near the end, trial ${trial}`,
      async () => {
        const playing = await waitPlaying(ctx, 60000);
        await ctx.evalYtm(`${PAGE} && document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi.seekTo(${playing.len - SEEK_BEFORE_END_S})`);
        const pre = await evalOnTarget(ctx.cdpPort, YTM_PAGE, `${PAGE}.fireAt(${FIRE_BEFORE_END_S})`, { timeoutMs: 35000 });
        const sentAt = Date.now();
        const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "next" } });
        if (res.status !== 204) throw new Error(`next returned ${res.status}`);
        const commandMs = Date.now() - sentAt;
        await sleep(WINDOW_MS + 500);
        const samples = await ctx.evalYtm(`${PAGE}.samples`);
        writeFileSync(path.join(ctx.runDir, `trial-${trial}.json`), JSON.stringify({ pre, commandMs, samples }, null, 1));
        const result = { trial, commandMs, ...classify(pre, samples) };
        results.push(result);
        ctx.emit("probe-next-near-end", result);
        if (result.outcome !== "clean") await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "play" } });
      },
      90000
    );
  }

  await ctx.step("every press landed on the next track from its start", async () => {
    const counts = {};
    for (const { outcome } of results) counts[outcome] = (counts[outcome] ?? 0) + 1;
    ctx.emit("probe-next-near-end-summary", counts);
    if (counts.clean !== TRIALS) throw new Error(`outcomes ${JSON.stringify(counts)}`);
  });
}
