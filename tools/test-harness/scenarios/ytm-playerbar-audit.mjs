import fs, { writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { hooksReadyStep, obtainCompanionToken, playbackFixture } from "./lib.mjs";

export const needsCompanion = true;
export const fixture = {
  playback: playbackFixture({ adBlockerEnabled: false, preventIdlePause: true }),
  themes: { active: null },
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
const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../src/themes");
const THEME_IDS = fs
  .readdirSync(THEMES_DIR)
  .filter(name => name !== "_base" && fs.statSync(path.join(THEMES_DIR, name)).isDirectory())
  .sort();

const PLAYER_BAR = "ytmusic-app-layout > ytmusic-player-bar";
const TARGETS = {
  progressSlider: "ytmusic-app-layout > ytmusic-player-bar #progress-bar",
  progressBar: "ytmusic-app-layout > ytmusic-player-bar #progress-bar #sliderBar",
  progressKnob: "ytmusic-app-layout > ytmusic-player-bar #progress-bar #sliderKnob",
  progressKnobInner: "ytmusic-app-layout > ytmusic-player-bar #progress-bar .slider-knob-inner",
  volumeSlider: "ytmusic-app-layout > ytmusic-player-bar #volume-slider",
  volumeBar: "ytmusic-app-layout > ytmusic-player-bar #volume-slider #sliderBar",
  volumeKnob: "ytmusic-app-layout > ytmusic-player-bar #volume-slider #sliderKnob",
  volumeKnobInner: "ytmusic-app-layout > ytmusic-player-bar #volume-slider .slider-knob-inner",
  volumeButton: "ytmusic-app-layout > ytmusic-player-bar yt-icon-button.volume",
  playPause: "ytmusic-app-layout > ytmusic-player-bar #play-pause-button",
  previous: "ytmusic-app-layout > ytmusic-player-bar .previous-button",
  next: "ytmusic-app-layout > ytmusic-player-bar .next-button",
  timeInfo: "ytmusic-app-layout > ytmusic-player-bar .time-info"
};

const SAMPLE = `JSON.stringify((() => {
  const targets = ${JSON.stringify(TARGETS)};
  const px = value => {
    const n = parseFloat(value);
    return Number.isNaN(n) ? 0 : Math.round(n * 10) / 10;
  };
  const pseudo = (el, which) => {
    const style = getComputedStyle(el, which);
    if (style.content === "none" || style.content === "normal") return null;
    return { w: px(style.width), h: px(style.height), position: style.position };
  };
  const layout = document.querySelector("ytmusic-app-layout");
  const playerBar = document.querySelector(${JSON.stringify(PLAYER_BAR)});
  const barBox = playerBar ? playerBar.getBoundingClientRect() : null;
  const origin = barBox ? { x: barBox.x + playerBar.clientLeft, y: barBox.y + playerBar.clientTop, width: barBox.width, height: barBox.height } : { x: 0, y: 0, width: 0, height: 0 };
  const out = {
    _page: {
      viewport: [innerWidth, innerHeight],
      visibility: document.visibilityState,
      layoutAttributes: layout ? [...layout.attributes].map(a => a.name) : null,
      themeChars: ((document.getElementById("ytmd-theme") || {}).textContent || "").length,
      playerBar: playerBar ? [px(origin.x), px(origin.y), px(origin.width), px(origin.height)] : null
    }
  };
  for (const [key, selector] of Object.entries(targets)) {
    const el = document.querySelector(selector);
    if (!el) {
      out[key] = { found: false };
      continue;
    }
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    out[key] = {
      found: true,
      x: px(box.x - origin.x),
      y: px(box.y - origin.y),
      w: px(box.width),
      h: px(box.height),
      cx: px(box.x - origin.x + box.width / 2),
      cy: px(box.y - origin.y + box.height / 2),
      position: style.position,
      transform: style.transform,
      before: pseudo(el, "::before"),
      after: pseudo(el, "::after")
    };
  }
  return out;
})())`;

const CENTRE_TOLERANCE = 1;
const SIZE_TOLERANCE = 2;
const PLAYHEAD_KEYS = new Set(["progressKnob", "progressKnobInner"]);
const KNOB_KEYS = new Set(["progressKnob", "volumeKnob"]);

function compare(stock, themed) {
  const failures = [];
  for (const [key, base] of Object.entries(stock)) {
    if (key === "_page" || !base.found) continue;
    const next = themed[key];
    if (!next || !next.found) {
      failures.push({ key, kind: "missing" });
      continue;
    }
    const dx = PLAYHEAD_KEYS.has(key) ? 0 : Math.abs(base.cx - next.cx);
    if (dx > CENTRE_TOLERANCE || Math.abs(base.cy - next.cy) > CENTRE_TOLERANCE) {
      failures.push({ key, kind: "centre", stock: [base.cx, base.cy], themed: [next.cx, next.cy] });
    }
    if (Math.abs(base.w - next.w) > SIZE_TOLERANCE || Math.abs(base.h - next.h) > SIZE_TOLERANCE) {
      failures.push({ key, kind: "size", stock: [base.w, base.h], themed: [next.w, next.h] });
    }
    if (KNOB_KEYS.has(key) && base.position !== next.position) {
      failures.push({ key, kind: "position", stock: base.position, themed: next.position });
    }
  }
  return failures;
}

const pump = ctx =>
  ctx.screenshotYtm().then(
    () => undefined,
    () => undefined
  );

async function sample(ctx) {
  await pump(ctx);
  return JSON.parse(await ctx.evalYtm(SAMPLE));
}

async function setTheme(ctx, id) {
  const previous = await ctx.evalYtm("(document.getElementById('ytmd-theme') || {}).textContent || ''");
  const result = JSON.parse(await ctx.evalOnTarget(SETTINGS_WINDOW, `window.ytmd.themes.setActive(${JSON.stringify(id)}).then(r => JSON.stringify(r))`));
  if (!result.ok) throw new Error(`setActive(${id}) refused: ${result.reason}`);
  await ctx.waitYtm(`((document.getElementById('ytmd-theme') || {}).textContent || '') !== ${JSON.stringify(previous)}`, changed => changed === true, 15000);
  await pump(ctx);
}

export default async function ytmPlayerBarAudit(ctx) {
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
      const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "changeVideo", data: { videoId: VIDEO_ID } } });
      if (res.status !== 204) throw new Error(`changeVideo returned ${res.status}`);
      const deadline = Date.now() + 90000;
      let last = null;
      let nudged = false;
      let reloaded = false;
      while (Date.now() < deadline) {
        const state = await ctx.companion.request("/api/v1/state", { token });
        if (state.status === 200) last = state.body;
        const progressing = last?.player?.trackState === 1 || last?.player?.adPlaying === true || (last?.player?.videoProgress ?? 0) > 0;
        if (progressing) return;
        if (!nudged && last?.player?.trackState === -1) {
          nudged = true;
          await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "play" } });
        } else if (nudged && !reloaded && last?.player?.trackState === -1) {
          reloaded = true;
          ctx.emit("probe-playback-reload", { videoId: VIDEO_ID });
          await ctx.evalYtm(RELOAD_TRACK);
        }
        await new Promise(resolve => setTimeout(resolve, 5500));
      }
      await describeStall(ctx, last);
      throw new Error(`video never progressed: trackState=${last?.player?.trackState} progress=${last?.player?.videoProgress}`);
    },
    120000
  );

  await ctx.step(
    "player bar rendered",
    () => ctx.waitYtm(`!!document.querySelector(${JSON.stringify(TARGETS.progressKnob)})`, found => found === true, 60000),
    65000
  );

  await ctx.step(
    "settings window open",
    async () => {
      await ctx.evalMain("window.ytmd.openSettingsWindow(); true");
      await ctx.waitTarget(SETTINGS_WINDOW, 20000);
      await ctx.waitOnTarget(SETTINGS_WINDOW, "!!(window.ytmd && window.ytmd.themes)", ready => ready === true, 20000);
    },
    45000
  );

  let stock;
  await ctx.step(
    "stock measured",
    async () => {
      stock = await sample(ctx);
      ctx.emit("probe-geometry-sample", { theme: null, sample: stock });
      const missing = Object.entries(stock)
        .filter(([key, entry]) => key !== "_page" && !entry.found)
        .map(([key]) => key);
      if (missing.length) ctx.emit("probe-geometry-missing", { theme: null, missing });
      if (!stock.progressKnob.found) throw new Error("progress knob not found in stock layout");
      if (stock.progressKnob.w === 0) throw new Error(`player bar has no layout: ${JSON.stringify(stock._page)}`);
    },
    30000
  );

  const summary = [];
  for (const id of THEME_IDS) {
    await ctx.step(
      `${id} measured`,
      async () => {
        await setTheme(ctx, id);
        const themed = await sample(ctx);
        ctx.emit("probe-geometry-sample", { theme: id, sample: themed });
        const failures = compare(stock, themed);
        for (const failure of failures) ctx.emit("probe-geometry", { theme: id, ...failure });
        summary.push({ theme: id, failures: failures.length });
      },
      45000
    );
  }
  ctx.emit("probe-geometry-summary", { themes: summary, failing: summary.filter(entry => entry.failures > 0).map(entry => entry.theme) });

  if (process.env.YTMD_PROBE_SHOT) {
    await ctx.step(
      "screenshot captured",
      async () => {
        if (process.env.YTMD_PROBE_THEME) await setTheme(ctx, process.env.YTMD_PROBE_THEME);
        const png = await ctx.screenshotYtm();
        fs.writeFileSync(process.env.YTMD_PROBE_SHOT, png);
        ctx.emit("probe-screenshot", { path: process.env.YTMD_PROBE_SHOT, bytes: png.length });
      },
      60000
    );
  }
}
