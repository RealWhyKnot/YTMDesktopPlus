import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { hooksReadyStep, obtainCompanionToken, playbackFixture } from "./lib.mjs";

export const needsCompanion = true;
export const fixture = {
  playback: playbackFixture({ adBlockerEnabled: false, preventIdlePause: true }),
  addons: {
    states: { blend: { enabled: true, riskAcknowledged: true } },
    settings: { blend: { seconds: 5, blendSkips: false } }
  },
  integrations: {
    companionServerEnabled: true,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false
  }
};

const VIDEO_ID = "dQw4w9WgXcQ";
const RELOAD_TRACK = `(() => {
  const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const api = bar && bar.playerApi;
  const data = api && api.getVideoData ? api.getVideoData() : null;
  if (api && api.loadVideoById && data && data.video_id) api.loadVideoById(data.video_id);
  return !!(data && data.video_id);
})()`;

const STALL_PROBE = `JSON.stringify((() => {
  const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  const api = bar && bar.playerApi;
  const video = document.querySelector("video");
  const pick = selector => [...document.querySelectorAll(selector)].map(el => el.tagName + ": " + (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 160)).filter(text => text.length > 6);
  return {
    href: location.href,
    playerState: api && api.getPlayerState ? api.getPlayerState() : null,
    videoId: api && api.getVideoData ? api.getVideoData().video_id : null,
    video: video ? { paused: video.paused, readyState: video.readyState, error: video.error ? video.error.code : null, src: (video.src || "").slice(0, 40) } : null,
    dialogs: pick("tp-yt-paper-dialog[opened], ytmusic-you-there-renderer, .ytp-error, yt-formatted-string.ytmusic-popup-container, ytmusic-popup-container tp-yt-paper-toast[opened]"),
    signedIn: !!document.querySelector("ytmusic-nav-bar img, #avatar img")
  };
})())`;

async function describeStall(ctx, last) {
  const detail = await ctx.evalYtm(STALL_PROBE).then(JSON.parse, error => ({ probeError: String(error) }));
  ctx.emit("probe-playback-stall", {
    player: last?.player ? { trackState: last.player.trackState, videoProgress: last.player.videoProgress, adPlaying: last.player.adPlaying } : null,
    ...detail
  });
  await ctx.screenshotYtm().then(
    png => writeFileSync(path.join(ctx.runDir, "playback-stall.png"), png),
    () => undefined
  );
}
const SETTINGS_WINDOW = /windows\/settings\/index\.html/;
const ARMED = /blend armed videoId=/;
const CUT_SKIP = /blend cut .*reason=skip/;
const BLEND_SKIP = /blend blend .*kind=skip/;

const countLines = (file, pattern) => {
  try {
    return readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(line => pattern.test(line)).length;
  } catch {
    return 0;
  }
};

async function waitCount(ctx, pattern, atLeast, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = countLines(ctx.mainLog, pattern);
    if (count >= atLeast) return count;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`${pattern} seen ${countLines(ctx.mainLog, pattern)} times, wanted ${atLeast}, within ${timeoutMs}ms`);
}

async function waitPlaying(ctx, token, minProgressS) {
  const deadline = Date.now() + 120000;
  let last = null;
  let nudged = false;
  let reloaded = false;
  while (Date.now() < deadline) {
    const state = await ctx.companion.request("/api/v1/state", { token });
    if (state.status === 200) last = state.body;
    const player = last?.player;
    if (player && player.trackState === 1 && player.adPlaying !== true && (player.videoProgress ?? 0) >= minProgressS) return player;
    if (!nudged && player && player.trackState === -1) {
      nudged = true;
      await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "play" } });
    } else if (nudged && !reloaded && player && player.trackState === -1) {
      reloaded = true;
      ctx.emit("probe-playback-reload", { videoId: player.videoId ?? VIDEO_ID });
      await ctx.evalYtm(RELOAD_TRACK);
    }
    await new Promise(resolve => setTimeout(resolve, 5500));
  }
  await describeStall(ctx, last);
  throw new Error(`track never reached ${minProgressS}s of clean playback: trackState=${last?.player?.trackState} progress=${last?.player?.videoProgress}`);
}

async function skip(ctx, token) {
  const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "next" } });
  if (res.status !== 204) throw new Error(`next returned ${res.status}`);
}

export default async function blendSkip(ctx) {
  let token;
  await ctx.step(
    "obtain token",
    async () => {
      token = await obtainCompanionToken(ctx);
    },
    90000
  );

  await hooksReadyStep(ctx);
  await ctx.step("blend active", () => ctx.waitMainLog(/Addon active: blend/, 60000), 65000);

  await ctx.step(
    "playback started",
    async () => {
      const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "changeVideo", data: { videoId: VIDEO_ID } } });
      if (res.status !== 204) throw new Error(`changeVideo returned ${res.status}`);
      await waitPlaying(ctx, token, 8);
    },
    130000
  );

  await ctx.step("shadow armed for the first track", () => waitCount(ctx, ARMED, 1, 60000), 65000);

  await ctx.step(
    "skip cuts while the toggle is off",
    async () => {
      const blendsBefore = countLines(ctx.mainLog, BLEND_SKIP);
      await skip(ctx, token);
      await waitCount(ctx, CUT_SKIP, 1, 30000);
      const blendsAfter = countLines(ctx.mainLog, BLEND_SKIP);
      ctx.emit("probe-blend-skip", { toggle: false, cuts: countLines(ctx.mainLog, CUT_SKIP), blends: blendsAfter });
      if (blendsAfter !== blendsBefore) throw new Error("a skip blended with the toggle off");
    },
    45000
  );

  await ctx.step(
    "toggle turned on from settings",
    async () => {
      await ctx.evalMain("window.ytmd.openSettingsWindow(); true");
      await ctx.waitTarget(SETTINGS_WINDOW, 20000);
      await ctx.waitOnTarget(SETTINGS_WINDOW, "!!(window.ytmd && window.ytmd.store)", ready => ready === true, 20000);
      await ctx.evalOnTarget(SETTINGS_WINDOW, 'window.ytmd.store.set("addons.settings.blend.blendSkips", true); true');
      await ctx.waitOnTarget(SETTINGS_WINDOW, 'window.ytmd.store.get("addons").then(a => a.settings.blend.blendSkips)', on => on === true, 10000);
    },
    60000
  );

  await ctx.step(
    "shadow armed for the second track",
    async () => {
      await waitPlaying(ctx, token, 8);
      await waitCount(ctx, ARMED, 2, 60000);
    },
    130000
  );

  await ctx.step(
    "skip blends once the toggle is on",
    async () => {
      const cutsBefore = countLines(ctx.mainLog, CUT_SKIP);
      await skip(ctx, token);
      await waitCount(ctx, BLEND_SKIP, 1, 30000);
      ctx.emit("probe-blend-skip", { toggle: true, cuts: countLines(ctx.mainLog, CUT_SKIP), blends: countLines(ctx.mainLog, BLEND_SKIP) });
      if (countLines(ctx.mainLog, CUT_SKIP) !== cutsBefore) throw new Error("a skip cut with the toggle on");
    },
    45000
  );
}
