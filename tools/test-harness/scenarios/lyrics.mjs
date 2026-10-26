import fs from "fs";
import path from "path";
import { hooksReadyStep, playbackFixture } from "./lib.mjs";

export const inspectMain = true;
export const fixture = {
  playback: playbackFixture({ adBlockerEnabled: true }),
  integrations: { companionServerEnabled: false, discordPresenceEnabled: false, lastFMEnabled: false }
};

const VIDEO_ID = "lYBUbBu4W08";
const TAB = 'ytmusic-player-page ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const MEASURE = `(() => {
  const tab = document.querySelector('${TAB}');
  const root = tab && tab.querySelector(".ytmd-lyrics");
  const native = tab && tab.querySelector(":scope > ytmusic-section-list-renderer");
  const video = document.querySelector("video");
  const side = document.querySelector("ytmusic-player-page #side-panel");
  const main = document.querySelector("ytmusic-player-page #main-panel");
  const lines = root ? [...root.querySelectorAll(".ytmd-lyrics-line")] : [];
  const activeIndex = lines.findIndex(line => line.classList.contains("is-active"));
  const active = lines[activeIndex];
  const tabBox = tab && tab.getBoundingClientRect();
  const rootBox = root && root.getBoundingClientRect();
  let overflow = 0;
  for (const line of lines) {
    const box = line.getBoundingClientRect();
    if (box.width === 0) continue;
    overflow = Math.max(overflow, box.right - rootBox.right, rootBox.left - box.left);
  }
  const activeBox = active && active.getBoundingClientRect();
  return {
    mounted: !!(root && root.isConnected),
    rootVisible: !!(root && root.getClientRects().length > 0),
    nativeHidden: !native || getComputedStyle(native).display === "none",
    timed: root ? root.dataset.timed : null,
    count: lines.length,
    activeIndex,
    activeStart: active ? Number(active.dataset.start) : null,
    timeMs: video ? video.currentTime * 1000 : null,
    paused: video ? video.paused : null,
    anchor: activeBox && tabBox ? (activeBox.top + activeBox.height / 2 - tabBox.top) / tab.clientHeight : null,
    scrollTop: tab ? tab.scrollTop : null,
    maxScroll: tab ? tab.scrollHeight - tab.clientHeight : null,
    overflow,
    rootScrollX: root ? root.scrollWidth - root.clientWidth : null,
    tabScrollX: tab ? tab.scrollWidth - tab.clientWidth : null,
    side: side ? side.getBoundingClientRect().width : null,
    main: main ? main.getBoundingClientRect().width : null,
    tabHeight: tab ? tab.clientHeight : null,
    viewport: [innerWidth, innerHeight]
  };
})()`;

const LINE_TIMES = `(() => [...document.querySelectorAll('${TAB} .ytmd-lyrics-line')].map(line => line.dataset.start === undefined ? null : Number(line.dataset.start)))()`;

export default async function lyrics(ctx) {
  const metrics = {};
  const save = () => fs.writeFileSync(path.join(ctx.runDir, "lyrics-metrics.json"), JSON.stringify(metrics, null, 2));
  const shot = async name => fs.writeFileSync(path.join(ctx.runDir, `${name}.png`), Buffer.from(await ctx.screenshotYtm(), "base64"));
  const measure = () => ctx.evalYtm(MEASURE);
  const api = `document.querySelector("ytmusic-app-layout>ytmusic-player-bar").playerApi`;
  try {
    await hooksReadyStep(ctx);
    await ctx.step("window stays off screen", async () => {
      const main = await ctx.evalMain(`({ x: window.screenX, w: window.outerWidth, focus: document.hasFocus() })`);
      metrics.window = main;
      if (main.focus) throw new Error("app window took focus");
    });

    await ctx.step("open the song", () => ctx.evalYtm(`(() => { location.href = "https://music.youtube.com/watch?v=${VIDEO_ID}"; return true; })()`), 10000);
    await sleep(3000);
    await hooksReadyStep(ctx);
    await ctx.step(
      "player plays the song",
      async () => {
        await ctx.waitYtm(`(() => { try { return ${api}.getVideoData().video_id; } catch { return null; } })()`, id => id === VIDEO_ID, 60000);
        await ctx.evalYtm(`${api}.playVideo()`);
        await ctx.waitYtm(
          `(() => { const v = document.querySelector("video"); return !!v && !v.paused && v.currentTime > 0.5; })()`,
          playing => playing === true,
          60000
        );
      },
      125000
    );

    await ctx.step(
      "lyrics tab shows synced lyrics in place of the native ones",
      async () => {
        await ctx.waitYtm(
          `(() => { const t = [...document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab")][1]; if (!t) return false; t.click(); return true; })()`,
          clicked => clicked === true,
          30000
        );
        const state = await ctx.waitYtm(MEASURE, value => value.mounted && value.rootVisible && value.timed === "true" && value.count > 10, 45000);
        metrics.mounted = state;
        if (!state.nativeHidden) throw new Error("native lyrics still showing");
      },
      80000
    );

    const times = await ctx.evalYtm(LINE_TIMES);
    metrics.lineTimes = times;

    const expectedAt = now => times.reduce((found, start, index) => (start !== null && start <= now ? index : found), -1);

    await ctx.step(
      "highlight moves with normal playback",
      async () => {
        await ctx.evalYtm(`${api}.seekTo(28, true)`);
        await ctx.waitYtm(`document.querySelector("video").currentTime`, time => time > 29, 20000);
        const samples = [];
        const startedAt = Date.now();
        while (Date.now() - startedAt < 12000) {
          await sleep(400);
          const state = await measure();
          samples.push({ timeMs: Math.round(state.timeMs), activeIndex: state.activeIndex, expected: expectedAt(state.timeMs + 120), anchor: state.anchor });
        }
        metrics.playback = samples;
        const advanced = samples.at(-1).timeMs - samples[0].timeMs;
        if (advanced < 9000) throw new Error(`video only advanced ${advanced}ms in 12s`);
        const seen = new Set(samples.map(sample => sample.activeIndex).filter(index => index >= 0));
        if (seen.size < 2) throw new Error(`highlight never moved: ${[...seen]}`);
        const wrong = samples.filter(sample => sample.activeIndex !== -1 && sample.activeIndex !== sample.expected);
        if (wrong.length > 1) throw new Error(`highlight lagged the audio: ${JSON.stringify(wrong)}`);
      },
      40000
    );

    for (const seconds of [40, 95, 150]) {
      await ctx.step(`highlight follows playback at ${seconds}s`, async () => {
        await ctx.evalYtm(`${api}.seekTo(${seconds}, true)`);
        await sleep(2500);
        const state = await measure();
        metrics[`at${seconds}`] = state;
        const lead = 120;
        const now = state.timeMs + lead;
        const expected = times.reduce((found, start, index) => (start !== null && start <= now ? index : found), -1);
        if (state.activeIndex !== -1 && state.activeIndex !== expected) throw new Error(`active ${state.activeIndex}, expected ${expected} at ${now}ms`);
        if (state.activeIndex === -1 && expected !== -1) {
          const end = await ctx.evalYtm(`window.__ytmdLyrics.data.lines[${expected}].end`);
          if (!(typeof end === "number" && end <= now)) throw new Error(`no active line at ${now}ms although line ${expected} runs to ${end}`);
        }
        if (state.activeIndex !== -1 && state.scrollTop > 2 && state.scrollTop < state.maxScroll - 2) {
          if (state.anchor < 0.25 || state.anchor > 0.45) throw new Error(`active line sits at ${state.anchor.toFixed(2)} of the panel`);
        }
      });
    }

    await ctx.step("clicking a line seeks to it", async () => {
      const state = await measure();
      const target = times.findIndex((start, index) => start !== null && index > Math.max(state.activeIndex, 0) + 3);
      await ctx.evalYtm(`document.querySelectorAll('${TAB} .ytmd-lyrics-line')[${target}].click()`);
      await sleep(800);
      const after = await measure();
      metrics.click = { target, start: times[target], timeMs: after.timeMs, activeIndex: after.activeIndex };
      if (!(after.timeMs >= times[target] - 50 && after.timeMs <= times[target] + 2000))
        throw new Error(`seeked to ${after.timeMs}ms, line starts at ${times[target]}ms`);
    });

    await ctx.step(
      "scrolling by hand holds auto-scroll, then it resumes",
      async () => {
        await ctx.evalYtm(
          `(() => { const tab = document.querySelector('${TAB}'); tab.dispatchEvent(new WheelEvent("wheel", { deltaY: -400 })); tab.scrollTop = 0; return true; })()`
        );
        const startedAt = Date.now();
        const held = [];
        while (Date.now() - startedAt < 4000) {
          await sleep(500);
          held.push((await measure()).scrollTop);
        }
        metrics.hold = held;
        if (held.some(top => top > 2)) throw new Error(`auto-scroll moved the panel during the hold: ${held.join(",")}`);
        const resumed = await ctx.waitYtm(MEASURE, value => value.scrollTop > 2, 15000);
        metrics.resumed = resumed;
      },
      30000
    );

    await ctx.step("other tabs hide the lyrics and coming back restores them", async () => {
      await ctx.evalYtm(`[...document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab")][0].click()`);
      await sleep(1200);
      const away = await ctx.evalYtm(
        `(() => { const r = document.querySelector(".ytmd-lyrics"); return { visible: !!(r && r.getClientRects().length), queue: !!document.querySelector("ytmusic-player-page ytmusic-player-queue-item") }; })()`
      );
      metrics.away = away;
      if (away.visible) throw new Error("lyrics visible on the Up next tab");
      await ctx.evalYtm(`[...document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab")][1].click()`);
      const back = await ctx.waitYtm(MEASURE, value => value.rootVisible && value.activeIndex >= 0, 15000);
      metrics.back = back;
    });

    await ctx.step("oversized lyrics never widen or shift the layout", async () => {
      const baseline = await measure();
      const results = await ctx.evalYtm(`(() => {
      const state = window.__ytmdLyrics;
      const saved = state.data;
      const id = saved.videoId;
      const word = "Supercalifragilistic".repeat(150);
      const many = Array.from({ length: 400 }, (_, i) => ({ text: "line " + i + " " + "la ".repeat(i % 40), start: i * 500, end: i * 500 + 500 }));
      const cases = {
        unbroken: { videoId: id, timed: true, source: "S".repeat(3000), lines: [{ text: word, start: 0, end: 600000 }] },
        wordy: { videoId: id, timed: true, source: null, lines: [{ text: "oh ".repeat(800), start: 0, end: 600000, words: Array.from({ length: 800 }, (_, i) => ({ text: "oh", start: i * 100 })) }] },
        many: { videoId: id, timed: true, source: "x", lines: many },
        staticLong: { videoId: id, timed: false, source: "y".repeat(500), lines: [{ text: word, start: null, end: null }, { text: "", start: null, end: null }, { text: "short", start: null, end: null }] },
        rtl: { videoId: id, timed: true, source: null, lines: [{ text: "שלום ".repeat(60), start: 0, end: 600000 }] }
      };
      const out = {};
      for (const [name, payload] of Object.entries(cases)) {
        state.apply(payload);
        const tab = document.querySelector('${TAB}');
        const root = tab.querySelector(".ytmd-lyrics");
        const rootBox = root.getBoundingClientRect();
        let overflow = 0;
        for (const el of root.querySelectorAll(".ytmd-lyrics-line, .ytmd-lyrics-source")) {
          const box = el.getBoundingClientRect();
          overflow = Math.max(overflow, box.right - rootBox.right, rootBox.left - box.left);
        }
        out[name] = {
          overflow,
          rootScrollX: root.scrollWidth - root.clientWidth,
          tabScrollX: tab.scrollWidth - tab.clientWidth,
          side: document.querySelector("ytmusic-player-page #side-panel").getBoundingClientRect().width,
          main: document.querySelector("ytmusic-player-page #main-panel").getBoundingClientRect().width,
          lines: root.querySelectorAll(".ytmd-lyrics-line").length
        };
      }
      state.apply(saved);
      return out;
    })()`);
      metrics.oversized = { baseline: { side: baseline.side, main: baseline.main }, results };
      for (const [name, result] of Object.entries(results)) {
        if (result.overflow > 1 || result.rootScrollX > 1 || result.tabScrollX > 1) throw new Error(`${name} overflows: ${JSON.stringify(result)}`);
        if (Math.abs(result.side - baseline.side) > 1 || Math.abs(result.main - baseline.main) > 1)
          throw new Error(`${name} shifted the layout: ${JSON.stringify(result)}`);
      }
    });

    await ctx.step(
      "text size sweep",
      async () => {
        const sizes = [];
        for (const [w, h] of [
          [1280, 720],
          [1000, 700],
          [1920, 1080]
        ]) {
          await ctx.evalMainProcess(
            `process.mainModule.require("electron").BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("windows/main/index.html")).setSize(${w}, ${h})`
          );
          await sleep(1500);
          for (let px = 14; px <= 32; px += 2) {
            sizes.push({
              window: [w, h],
              px,
              ...(await ctx.evalYtm(`(() => {
              const tab = document.querySelector('${TAB}');
              const root = tab.querySelector(".ytmd-lyrics");
              root.style.fontSize = "${px}px";
              const lines = [...root.querySelectorAll(".ytmd-lyrics-line:not(.is-break):not(.is-gap)")];
              const rowHeight = ${px} * 1.3;
              const rows = lines.map(line => Math.round(line.getBoundingClientRect().height / rowHeight));
              const chars = lines.reduce((sum, line) => sum + line.textContent.length, 0);
              const totalRows = rows.reduce((a, b) => a + b, 0);
              const firstLine = lines[0].getBoundingClientRect();
              const pitch = lines[1].getBoundingClientRect().top - firstLine.top;
              return {
                panel: Math.round(root.clientWidth),
                charsPerRow: +(chars / totalRows).toFixed(1),
                wrapShare: +(rows.filter(r => r > 1).length / rows.length).toFixed(2),
                maxRows: Math.max(...rows),
                linesInView: +(tab.clientHeight / pitch).toFixed(1)
              };
            })()`))
            });
          }
        }
        await ctx.evalYtm(`document.querySelector('${TAB} .ytmd-lyrics').style.fontSize = ""`);
        await ctx.evalMainProcess(
          `process.mainModule.require("electron").BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes("windows/main/index.html")).setSize(1280, 720)`
        );
        metrics.sizes = sizes;
      },
      120000
    );

    await sleep(1500);
    await ctx.evalYtm(`${api}.seekTo(60, true)`);
    await sleep(2500);
    await shot("after");
    await ctx.step("changing the text size keeps the sung line in place", async () => {
      const anchors = {};
      for (const px of [22, 26, 18]) {
        await ctx.evalYtm(`document.querySelector('${TAB} .ytmd-lyrics').style.fontSize = "${px}px"`);
        await sleep(1200);
        anchors[px] = (await measure()).anchor;
        if (px !== 18) await shot(`after-${px}px`);
      }
      await ctx.evalYtm(`document.querySelector('${TAB} .ytmd-lyrics').style.fontSize = ""`);
      metrics.resizeAnchors = anchors;
      for (const [px, anchor] of Object.entries(anchors)) {
        if (anchor !== null && (anchor < 0.3 || anchor > 0.4)) throw new Error(`at ${px}px the sung line sits at ${anchor.toFixed(2)} of the panel`);
      }
    });
    await ctx.step("native view comes back when the addon lets go", async () => {
      await ctx.evalYtm(`window.__ytmdLyrics.apply({ disable: true })`);
      await sleep(800);
      const state = await measure();
      if (state.mounted) throw new Error("lyrics view left behind after disable");
      if (state.nativeHidden) throw new Error("native lyrics still hidden after disable");
      await shot("before");
    });
  } finally {
    save();
  }
}
