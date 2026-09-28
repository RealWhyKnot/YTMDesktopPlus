import { writeFileSync } from "node:fs";
import path from "node:path";
import { listTargets } from "../cdp.mjs";
import { hooksReadyStep, obtainCompanionToken, playbackFixture } from "./lib.mjs";

export const needsCompanion = true;

const METHOD = process.env.FIRST_SKIP_METHOD ?? "button";
const TRIALS = Number(process.env.FIRST_SKIP_TRIALS) || 12;

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
const PRESS_AT_S = Number(process.env.FIRST_SKIP_AT) || 2;
const SETTLE_MS = Number(process.env.FIRST_SKIP_SETTLE_MS) || 0;
const NAVIGATE = process.env.FIRST_SKIP_NAVIGATE !== "0";
const WINDOW_MS = 7000;
const YTM_PAGE = /music\.youtube\.com/;

function recorder(options) {
  if (window.__fs) return;
  const PLAYER_BAR = "ytmusic-app-layout>ytmusic-player-bar";
  const log = [];
  const fs = { t0: Date.now(), log, samples: [], mediaCount: 0 };
  window.__fs = fs;
  const push = (kind, data) => {
    if (log.length < 8000) log.push({ at: Date.now(), kind, ...data });
  };
  const round = value => (typeof value === "number" ? Math.round(value * 100) / 100 : value);
  const attempt = (fn, fallback = null) => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  window.addEventListener(
    "error",
    event => {
      if (!(event instanceof ErrorEvent)) return;
      push("error", {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: String(event.error?.stack ?? "").slice(0, 2000)
      });
    },
    true
  );
  window.addEventListener("unhandledrejection", event => push("rejection", { reason: String(event.reason?.stack ?? event.reason).slice(0, 2000) }));

  const MEDIA_EVENTS = [
    "loadstart",
    "emptied",
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "play",
    "playing",
    "pause",
    "waiting",
    "seeking",
    "seeked",
    "ended",
    "error",
    "abort",
    "stalled",
    "ratechange",
    "volumechange"
  ];
  for (const type of MEDIA_EVENTS) {
    document.addEventListener(
      type,
      event => {
        const media = event.target;
        if (!(media instanceof HTMLMediaElement)) return;
        media.__fsId ??= ++fs.mediaCount;
        push("media", {
          type,
          id: media.__fsId,
          cur: round(media.currentTime),
          dur: round(media.duration),
          paused: media.paused,
          rs: media.readyState,
          rate: media.playbackRate,
          muted: media.muted
        });
      },
      true
    );
  }

  const bar = () => document.querySelector(PLAYER_BAR);
  const movie = () => {
    const element = document.querySelector("#movie_player");
    return element && typeof element.getPlayerState === "function" ? element : null;
  };
  let trapped = null;
  if (options.trapStore) {
    const capture = function () {
      try {
        if (!trapped && typeof this?.store?.getState === "function") trapped = this.store;
      } catch {
        trapped = null;
      }
    };
    Object.defineProperty(window, "PolymerFakeBaseClassWithoutHtml", { configurable: true, get: () => capture, set() {} });
  }
  let resolved = null;
  let resolving = false;
  const resolveApi = () => {
    const element = bar();
    if (resolved || resolving || typeof element?.resolvePlayerApi !== "function") return resolved;
    resolving = true;
    Promise.resolve(element.resolvePlayerApi()).then(
      api => {
        resolved = api ?? null;
        resolving = false;
      },
      () => {
        resolving = false;
      }
    );
    return resolved;
  };
  fs.api = () => bar()?.playerApi ?? resolveApi() ?? movie();
  fs.store = () => window.__YTMD_HOOK__?.ytmStore ?? trapped;

  const entryRenderer = entry =>
    entry?.playlistPanelVideoRenderer ?? entry?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer ?? null;
  const scalars = object => {
    const out = {};
    for (const [key, value] of Object.entries(object ?? {})) {
      if (value === null || typeof value !== "object") out[key] = typeof value === "string" ? value.slice(0, 60) : value;
    }
    return out;
  };
  const describeEntry = entry => {
    const wrapper = entry?.playlistPanelVideoWrapperRenderer;
    const primary = entryRenderer(entry);
    const length = renderer => renderer?.lengthText?.runs?.[0]?.text ?? null;
    return {
      videoId: primary?.videoId ?? null,
      length: length(primary),
      counterparts: (wrapper?.counterpart ?? []).map(counterpart => {
        const renderer = counterpart?.counterpartRenderer?.playlistPanelVideoRenderer;
        return { videoId: renderer?.videoId ?? null, length: length(renderer), segmentMap: JSON.stringify(counterpart?.segmentMap ?? null).slice(0, 600) };
      })
    };
  };
  const selected = queue => {
    const all = [...(queue?.items ?? []), ...(queue?.automixItems ?? [])].map(entryRenderer);
    const index = all.findIndex(renderer => renderer?.selected);
    return { all, index };
  };
  fs.queue = queue => {
    if (!queue) return null;
    const { all, index } = selected(queue);
    return {
      items: queue.items?.length ?? 0,
      automix: queue.automixItems?.length ?? 0,
      sel: index,
      cur: all[index]?.videoId ?? null,
      next: all[index + 1]?.videoId ?? null,
      ...scalars(queue)
    };
  };

  let wrapper = null;
  const findWrapper = () => {
    const seen = new Set();
    let frontier = [...document.querySelectorAll("ytmusic-app, ytmusic-app-layout, ytmusic-player-bar, ytmusic-player, ytmusic-player-page")].map(element => ({
      value: element,
      path: element.tagName.toLowerCase()
    }));
    for (let depth = 0; depth < 3; depth++) {
      const next = [];
      for (const { value, path } of frontier) {
        const names = attempt(() => Object.getOwnPropertyNames(value), []);
        for (const name of names) {
          const child = attempt(() => value[name]);
          if (!child || typeof child !== "object" || child instanceof Node || seen.has(child) || (Array.isArray(child) && child.length > 50)) continue;
          seen.add(child);
          if (Object.prototype.hasOwnProperty.call(child, "counterpartTrackMs")) {
            fs.wrapperPath = `${path}.${name}`;
            return child;
          }
          if (next.length < 20000) next.push({ value: child, path: `${path}.${name}` });
        }
      }
      frontier = next;
    }
    return null;
  };
  fs.counterpart = () => (wrapper ? { trackMs: wrapper.counterpartTrackMs, op: wrapper.operationType } : null);
  let wrapperTries = 0;
  const watchWrapper = setInterval(() => {
    wrapper = attempt(findWrapper);
    if (wrapper) push("wrapper-found", { path: fs.wrapperPath, ...fs.counterpart() });
    if (wrapper || ++wrapperTries > 40) clearInterval(watchWrapper);
  }, 500);
  let lastCounterpart = 0;

  const watchStore = setInterval(() => {
    const found = fs.store();
    if (!found) return;
    clearInterval(watchStore);
    let state = found.getState();
    push("store-ready", { slices: Object.keys(state), player: scalars(state.player), queue: fs.queue(state.queue) });
    found.subscribe(() => {
      const next = found.getState();
      if (next.queue !== state.queue) push("queue", fs.queue(next.queue));
      if (wrapper && wrapper.counterpartTrackMs !== lastCounterpart) {
        lastCounterpart = wrapper.counterpartTrackMs;
        push("counterpart", fs.counterpart());
      }
      if (next.player !== state.player) {
        const before = scalars(state.player);
        const after = scalars(next.player);
        const changed = {};
        for (const key of Object.keys(after)) if (after[key] !== before[key]) changed[key] = after[key];
        if (Object.keys(changed).length) push("player", changed);
      }
      state = next;
    });
    const dispatch = found.dispatch;
    found.dispatch = function (action) {
      if (action && typeof action.type === "string") push("action", { type: action.type });
      return dispatch.apply(this, arguments);
    };
  }, 50);

  const watchApi = setInterval(() => {
    const player = movie();
    if (!player || typeof player.addEventListener !== "function") return;
    clearInterval(watchApi);
    const videoId = () => attempt(() => player.getVideoData()?.video_id ?? null);
    push("api-ready", {});
    player.addEventListener("onStateChange", state => push("state", { state, videoId: videoId(), cur: round(attempt(() => player.getCurrentTime())) }));
    player.addEventListener("onVideoDataChange", event => push("data", { type: event?.type, playertype: event?.playertype, videoId: videoId() }));
    player.addEventListener("onError", error => push("player-error", { error: String(error) }));
  }, 50);

  fs.read = () => {
    const player = fs.api();
    if (!player) return null;
    const video = document.querySelector("#movie_player video") ?? document.querySelector("video");
    const state = attempt(() => fs.store()?.getState());
    return {
      videoId: attempt(() => player.getVideoData()?.video_id ?? null),
      cur: round(attempt(() => player.getCurrentTime())),
      dur: round(attempt(() => player.getDuration())),
      state: attempt(() => player.getPlayerState()),
      ad: state?.player?.adPlaying === true,
      qCur: state
        ? (() => {
            const { all, index } = selected(state.queue);
            return all[index]?.videoId ?? null;
          })()
        : null,
      vCur: round(video?.currentTime),
      vPaused: video?.paused ?? null,
      vRate: video?.playbackRate ?? null,
      vRs: video?.readyState ?? null
    };
  };

  fs.setup = () => ({
    hook: !!window.__YTMD_HOOK__,
    nonStop: !!window.__ytmdNonStop,
    adSkip: !!window.__ytmdAdSkip,
    adPrune: window.__ytmdAdPrune ? { enabled: window.__ytmdAdPrune.enabled, count: window.__ytmdAdPrune.count } : null,
    audioGraph: !!window.__ytmdAudioGraph,
    arrows: !!document.querySelector(".ytmd-history-back"),
    sleepTimer: !!document.querySelector(".sleep-timer-button"),
    via: bar()?.__ytmdPlayerApiVia ?? null,
    apiIsMovie: fs.api() === movie(),
    videos: document.querySelectorAll("video").length
  });

  fs.arm = (method, atS, windowMs) =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const tick = () => {
        const now = fs.read();
        if (now && now.state === 1 && !now.ad && now.cur >= atS) {
          const player = fs.api();
          const queue = attempt(() => fs.store()?.getState()?.queue);
          const entries = [...(queue?.items ?? []), ...(queue?.automixItems ?? [])];
          const { index } = selected(queue);
          const pre = {
            currentEntry: attempt(() => describeEntry(entries[index])),
            nextEntry: attempt(() => describeEntry(entries[index + 1])),
            ...now,
            len: Number(attempt(() => player.getPlayerResponse()?.videoDetails?.lengthSeconds)) || 0,
            loaded: round(attempt(() => player.getVideoLoadedFraction())),
            queue: fs.queue(queue),
            setup: fs.setup(),
            counterpart: fs.counterpart(),
            docAgeMs: Date.now() - fs.t0
          };
          const pressAt = Date.now();
          if (method === "button") bar().querySelector(".next-button").click();
          else if (method === "api") player.nextVideo();
          fs.samples = [];
          const timer = setInterval(() => {
            fs.samples.push({ t: Date.now() - pressAt, ...fs.read(), ctm: wrapper ? wrapper.counterpartTrackMs : null });
            if (Date.now() - pressAt >= windowMs) clearInterval(timer);
          }, 100);
          resolve({ pre, pressAt });
        } else if (Date.now() > deadline) {
          reject(new Error("press point not reached: " + JSON.stringify(now)));
        } else {
          setTimeout(tick, 5);
        }
      };
      tick();
    });

  fs.dump = () => ({ t0: fs.t0, log, samples: fs.samples, setup: fs.setup(), ua: navigator.userAgent });
}

const recorderSource = (options = {}) => `(${recorder.toString()})(${JSON.stringify(options)})`;

export async function attachPage(port, pattern = YTM_PAGE) {
  const target = (await listTargets(port)).find(t => t.type === "page" && pattern.test(t.url));
  if (!target) throw new Error(`no target matching ${pattern}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("cdp socket error"));
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id === undefined) {
      for (const listener of listeners) listener(message);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(message.result);
  };
  ws.onclose = () => {
    for (const waiter of pending.values()) waiter.reject(new Error("cdp socket closed"));
    pending.clear();
  };
  const send = (method, params = {}, timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: value => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timer);
          reject(error);
        }
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression, timeoutMs = 15000) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(`evaluation threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result?.value;
  };
  return { send, evaluate, onEvent: listener => listeners.push(listener), close: () => ws.close() };
}

function createCollector(page) {
  let trace = null;
  let requests = null;
  let offset = 0;
  const reset = () => {
    trace = { exceptions: [], consoleErrors: [], youtubei: [], failed: [], media: [] };
    requests = new Map();
  };
  reset();
  const wall = timestamp => Math.round(timestamp * 1000 + offset);
  page.onEvent(({ method, params }) => {
    if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails;
      trace.exceptions.push({
        at: Math.round(params.timestamp),
        text: details.text,
        description: String(details.exception?.description ?? "").slice(0, 400),
        url: details.url,
        line: details.lineNumber,
        col: details.columnNumber,
        frames: (details.stackTrace?.callFrames ?? [])
          .slice(0, 12)
          .map(frame => `${frame.functionName || "?"}@${frame.url.split("/").pop()}:${frame.lineNumber}:${frame.columnNumber}`)
      });
    } else if (method === "Runtime.consoleAPICalled" && params.type === "error") {
      trace.consoleErrors.push({
        at: Math.round(params.timestamp),
        text: params.args
          .map(arg => String(arg.value ?? arg.description ?? ""))
          .join(" ")
          .slice(0, 400),
        frames: (params.stackTrace?.callFrames ?? [])
          .slice(0, 6)
          .map(frame => `${frame.functionName || "?"}@${frame.url.split("/").pop()}:${frame.lineNumber}:${frame.columnNumber}`)
      });
    } else if (method === "Network.requestWillBeSent") {
      offset = params.wallTime * 1000 - params.timestamp * 1000;
      const url = new URL(params.request.url);
      const entry = { at: Math.round(params.wallTime * 1000), url: `${url.host}${url.pathname}`.slice(0, 120) };
      requests.set(params.requestId, entry);
      if (url.pathname.includes("/youtubei/v1/")) {
        entry.endpoint = url.pathname.split("/youtubei/v1/")[1];
        trace.youtubei.push(entry);
      } else if (url.pathname.endsWith("/videoplayback")) {
        trace.media.push({
          at: entry.at,
          dur: url.searchParams.get("dur"),
          itag: url.searchParams.get("itag"),
          rn: url.searchParams.get("rn"),
          range: url.searchParams.get("range")
        });
      }
    } else if (method === "Network.responseReceived") {
      const entry = requests.get(params.requestId);
      if (entry?.endpoint) entry.status = params.response.status;
    } else if (method === "Network.loadingFinished") {
      const entry = requests.get(params.requestId);
      if (entry?.endpoint) entry.doneAt = wall(params.timestamp);
    } else if (method === "Network.loadingFailed") {
      const entry = requests.get(params.requestId);
      trace.failed.push({
        at: wall(params.timestamp),
        url: entry?.url ?? "?",
        errorText: params.errorText,
        blockedReason: params.blockedReason ?? null,
        canceled: params.canceled ?? false
      });
      if (entry?.endpoint) entry.failed = params.errorText;
    }
  });
  return { reset, take: () => trace };
}

function classify(pre, samples) {
  const seen = samples.filter(sample => sample.videoId);
  const last = seen.at(-1);
  const base = { from: pre.videoId, expectedNext: pre.queue?.next ?? null };
  if (!last) return { ...base, outcome: "no-samples" };
  const adSeen = seen.some(sample => sample.ad);
  const fastSeen = seen.some(sample => sample.vRate > 1);
  const flags = { ...(adSeen ? { adSeen } : {}), ...(fastSeen ? { fastSeen } : {}) };
  if (last.videoId === pre.videoId) {
    const outcome = last.state === 5 ? "cued-old" : last.cur < pre.cur ? "restarted-same" : "no-advance";
    return { ...base, ...flags, outcome, lastState: last.state, lastCur: last.cur, lastPaused: last.vPaused };
  }
  const changed = seen.find(sample => sample.videoId === last.videoId);
  const firstPlaying = seen.find(sample => sample.videoId === last.videoId && sample.state === 1);
  const result = { ...base, ...flags, to: last.videoId, changedAtMs: changed.t, matchesQueue: last.videoId === base.expectedNext };
  if (!firstPlaying) return { ...result, outcome: "not-playing", lastState: last.state, lastCur: last.cur };
  const startedAt = Math.round((last.cur - (last.t - firstPlaying.t) / 1000) * 100) / 100;
  return { ...result, playingAtMs: firstPlaying.t, firstPlayingCur: firstPlaying.cur, startedAt, outcome: firstPlaying.cur > 2 ? "late-start" : "clean" };
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(probe, timeoutMs, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe().catch(error => ({ error: String(error) }));
    if (last && !last.error) return last;
    await sleep(intervalMs);
  }
  throw new Error(`condition not met within ${timeoutMs}ms (last=${JSON.stringify(last)})`);
}

function relative(record, zero) {
  const shift = entries => entries.map(({ at, doneAt, ...rest }) => ({ ms: at - zero, ...(doneAt ? { doneMs: doneAt - zero } : {}), ...rest }));
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, Array.isArray(value) && value[0]?.at !== undefined ? shift(value) : value]));
}

export async function instrumentPage(page, options) {
  const source = recorderSource(options);
  const collector = createCollector(page);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  await page.send("Network.enable");
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source });
  await page.evaluate(source);
  return collector;
}

export async function runFirstSkips({
  page,
  collector,
  runDir,
  emit,
  step,
  ready,
  changeVideo,
  next,
  method = METHOD,
  trials = TRIALS,
  settleMs = SETTLE_MS,
  navigate = NAVIGATE
}) {
  const results = [];
  for (let trial = 0; trial <= trials; trial++) {
    await step(
      `first skip after load, trial ${trial}`,
      async () => {
        collector.reset();
        const loadAt = Date.now();
        if (trial > 0) {
          await page.send("Page.reload", {});
          await waitFor(async () => ((await page.evaluate("window.__fs ? window.__fs.t0 : 0")) > loadAt ? true : null), 60000);
        }
        await waitFor(async () => ((await page.evaluate(`!!window.__fs.api() && ${ready}`)) ? true : null), 90000);
        const hookMs = Date.now() - loadAt;
        await sleep(settleMs);

        const attempts = [];
        for (let attempt = 1; navigate || trial === 0; attempt++) {
          if (attempt > 8) throw new Error(`${VIDEO_ID} never started: ${JSON.stringify(attempts.at(-1))}`);
          const sentMs = Date.now() - loadAt;
          const status = await changeVideo(VIDEO_ID);
          const playing = await waitFor(async () => {
            const now = await page.evaluate("window.__fs.read()");
            return now && now.videoId === VIDEO_ID && now.state === 1 && !now.ad ? now : null;
          }, 10000).catch(() => null);
          attempts.push({ attempt, sentMs, status, playing: !!playing, last: playing ?? (await page.evaluate("window.__fs.read()").catch(() => null)) });
          if (playing) break;
        }

        const armed = await page.evaluate(`window.__fs.arm(${JSON.stringify(method)}, ${PRESS_AT_S}, ${WINDOW_MS})`, 40000);
        let commandMs = null;
        if (method === "companion") {
          const sentAt = Date.now();
          await next();
          commandMs = Date.now() - sentAt;
        }
        await sleep(WINDOW_MS + 500);
        const dump = await page.evaluate("window.__fs.dump()", 30000);
        const trace = collector.take();
        const result = {
          trial,
          method,
          attempts: attempts.length,
          hookMs,
          pressDocMs: armed.pre.docAgeMs,
          queueAtPress: armed.pre.queue && `${armed.pre.queue.items}+${armed.pre.queue.automix}${armed.pre.queue.isGenerating ? " generating" : ""}`,
          counterpartMsAtPress: armed.pre.counterpart?.trackMs ?? null,
          ...classify(armed.pre, dump.samples)
        };
        results.push(result);
        writeFileSync(
          path.join(runDir, `trial-${trial}.json`),
          JSON.stringify(
            {
              result,
              pre: armed.pre,
              commandMs,
              attempts,
              setupAfter: dump.setup,
              ua: dump.ua,
              docT0Ms: dump.t0 - armed.pressAt,
              samples: dump.samples,
              ...relative({ log: dump.log, ...trace }, armed.pressAt)
            },
            null,
            1
          )
        );
        emit("probe-first-skip", result);
      },
      180000
    );
  }
  return results;
}

export default async function firstSkip(ctx) {
  let token;
  await ctx.step(
    "obtain token",
    async () => {
      token = await obtainCompanionToken(ctx);
    },
    90000
  );
  await hooksReadyStep(ctx);

  const page = await attachPage(ctx.cdpPort);
  const collector = await instrumentPage(page);
  ctx.emit("probe-first-skip-config", { method: METHOD, trials: TRIALS, pressAtS: PRESS_AT_S, settleMs: SETTLE_MS, navigate: NAVIGATE, fixture });

  const command = (name, data) =>
    ctx.companion.request("/api/v1/command", { method: "POST", token, body: data === undefined ? { command: name } : { command: name, data } });
  const results = await runFirstSkips({
    page,
    collector,
    runDir: ctx.runDir,
    emit: ctx.emit,
    step: ctx.step,
    ready: "!!window.__YTMD_HOOK__",
    changeVideo: videoId => command("changeVideo", { videoId }).then(res => res.status),
    next: () => command("next")
  });
  page.close();

  await ctx.step("every first skip landed on the next track from its start", async () => {
    const counts = {};
    for (const { trial, outcome } of results) if (trial > 0) counts[outcome] = (counts[outcome] ?? 0) + 1;
    ctx.emit("probe-first-skip-summary", { launch: results[0]?.outcome, reloads: counts });
    if (results.some(result => result.outcome !== "clean")) throw new Error(`launch ${results[0]?.outcome}, reloads ${JSON.stringify(counts)}`);
  });
}
