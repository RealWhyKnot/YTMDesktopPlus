import { stringValue, array, defined, numberValue, optionalRecord, record } from "../values.ts";
import { messageResult, parseCdpMessage, type CdpMessage, type CdpResult } from "../cdp-values.ts";
import type { HarnessContext } from "../run.ts";
import { recorder } from "./first-skip-recorder.ts";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { listTargets } from "../cdp.ts";
import { hooksReadyStep, obtainCompanionToken, playbackFixture } from "./lib.ts";

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
    lastFMEnabled: false,
  },
};

const VIDEO_ID = "dQw4w9WgXcQ";
const PRESS_AT_S = Number(process.env.FIRST_SKIP_AT) || 2;
const SETTLE_MS = Number(process.env.FIRST_SKIP_SETTLE_MS) || 0;
const isNAVIGATE = process.env.FIRST_SKIP_NAVIGATE !== "0";
const WINDOW_MS = 7000;
const YTM_PAGE = /music\.youtube\.com/;

const recorderSource = (options = {}) => `(${recorder.toString()})(${JSON.stringify(options)})`;

export async function attachPage(port: number | null, pattern = YTM_PAGE) {
  const target = (await listTargets(port)).find((t) => t.type === "page" && pattern.test(t.url));
  if (!target) throw new Error(`no target matching ${pattern}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<Event>((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("cdp socket error"));
  });
  let nextId = 0;
  const pending = new Map<number, { resolve(value: CdpResult): void; reject(error: Error): void }>();
  const listeners: ((message: CdpMessage) => void)[] = [];
  ws.onmessage = (event) => {
    const message = parseCdpMessage(event.data);
    if (message.id === undefined) {
      for (const listener of listeners) listener(message);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message));
    else waiter.resolve(messageResult(message));
  };
  ws.onclose = () => {
    for (const waiter of pending.values()) waiter.reject(new Error("cdp socket closed"));
    pending.clear();
  };
  const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 15000) =>
    new Promise<CdpResult>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout after ${timeoutMs}ms: ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaluate = async (expression: string, timeoutMs = 15000) => {
    const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (result.exceptionDetails) throw new Error(`evaluation threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    return result.result?.value;
  };
  return { send, evaluate, onEvent: (listener: (message: CdpMessage) => void) => listeners.push(listener), close: () => ws.close() };
}

type Page = Awaited<ReturnType<typeof attachPage>>;
type RequestEntry = { at: number; url: string; endpoint?: string; status?: unknown; doneAt?: number; failed?: unknown };
function createCollector(page: Page) {
  let trace: {
    exceptions: Record<string, unknown>[];
    consoleErrors: Record<string, unknown>[];
    youtubei: RequestEntry[];
    failed: Record<string, unknown>[];
    media: Record<string, unknown>[];
  } = { exceptions: [], consoleErrors: [], youtubei: [], failed: [], media: [] };
  let requests = new Map<unknown, RequestEntry>();
  let offset = 0;
  const reset = () => {
    trace = { exceptions: [], consoleErrors: [], youtubei: [], failed: [], media: [] };
    requests = new Map();
  };
  reset();
  const wall = (timestamp: number) => Math.round(timestamp * 1000 + offset);
  page.onEvent(({ method, params: input }) => {
    const params = record(input);
    if (method === "Runtime.exceptionThrown") {
      const details = params.exceptionDetails;
      const description: unknown = optionalRecord(record(details).exception)?.description ?? "";
      trace.exceptions.push({
        at: Math.round(numberValue(params.timestamp)),
        text: record(details).text,
        description: String(description).slice(0, 400),
        url: record(details).url,
        line: record(details).lineNumber,
        col: record(details).columnNumber,
        frames: array(optionalRecord(record(details).stackTrace)?.callFrames ?? [])
          .slice(0, 12)
          .map(record)
          .map((frame) => {
            const name = frame.functionName;
            const hasName = Boolean(name);
            const functionName = hasName ? stringValue(name) : "?";
            return `${functionName}@${stringValue(frame.url).split("/").pop()}:${String(frame.lineNumber)}:${String(frame.columnNumber)}`;
          }),
      });
    } else if (method === "Runtime.consoleAPICalled" && params.type === "error") {
      trace.consoleErrors.push({
        at: Math.round(numberValue(params.timestamp)),
        text: array(params.args)
          .map((arg) => {
            const value: unknown = record(arg).value ?? record(arg).description ?? "";
            return String(value);
          })
          .join(" ")
          .slice(0, 400),
        frames: array(optionalRecord(params.stackTrace)?.callFrames ?? [])
          .slice(0, 6)
          .map(record)
          .map((frame) => {
            const name = frame.functionName;
            const hasName = Boolean(name);
            const functionName = hasName ? stringValue(name) : "?";
            return `${functionName}@${stringValue(frame.url).split("/").pop()}:${String(frame.lineNumber)}:${String(frame.columnNumber)}`;
          }),
      });
    } else if (method === "Network.requestWillBeSent") {
      offset = numberValue(params.wallTime) * 1000 - numberValue(params.timestamp) * 1000;
      const url = new URL(stringValue(record(params.request).url));
      const entry: RequestEntry = { at: Math.round(numberValue(params.wallTime) * 1000), url: `${url.host}${url.pathname}`.slice(0, 120) };
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
          range: url.searchParams.get("range"),
        });
      }
    } else if (method === "Network.responseReceived") {
      const entry = requests.get(params.requestId);
      if (entry?.endpoint) entry.status = record(params.response).status;
    } else if (method === "Network.loadingFinished") {
      const entry = requests.get(params.requestId);
      if (entry?.endpoint) entry.doneAt = wall(numberValue(params.timestamp));
    } else if (method === "Network.loadingFailed") {
      const entry = requests.get(params.requestId);
      trace.failed.push({
        at: wall(numberValue(params.timestamp)),
        url: entry?.url ?? "?",
        errorText: params.errorText,
        blockedReason: params.blockedReason ?? null,
        canceled: params.canceled ?? false,
      });
      if (entry?.endpoint) entry.failed = params.errorText;
    }
  });
  return { reset, take: () => trace };
}

function classify(pre: Record<string, unknown>, samples: Record<string, unknown>[]) {
  const seen = samples.filter((sample) => sample.videoId);
  const last = seen.at(-1);
  const base = { from: pre.videoId, expectedNext: optionalRecord(pre.queue)?.next ?? null };
  if (!last) return { ...base, outcome: "no-samples" };
  const isAdSeen = seen.some((sample) => sample.ad);
  const isFastSeen = seen.some((sample) => numberValue(sample.vRate) > 1);
  const flags = { ...(isAdSeen ? { adSeen: isAdSeen } : {}), ...(isFastSeen ? { fastSeen: isFastSeen } : {}) };
  if (last.videoId === pre.videoId) {
    const outcome = last.state === 5 ? "cued-old" : numberValue(last.cur) < numberValue(pre.cur) ? "restarted-same" : "no-advance";
    return { ...base, ...flags, outcome, lastState: last.state, lastCur: last.cur, lastPaused: last.vPaused };
  }
  const changed = seen.find((sample) => sample.videoId === last.videoId);
  const firstPlaying = seen.find((sample) => sample.videoId === last.videoId && sample.state === 1);
  const result = { ...base, ...flags, to: last.videoId, changedAtMs: defined(changed).t, matchesQueue: last.videoId === base.expectedNext };
  if (!firstPlaying) return { ...result, outcome: "not-playing", lastState: last.state, lastCur: last.cur };
  const startedAt = Math.round((numberValue(last.cur) - (numberValue(last.t) - numberValue(firstPlaying.t)) / 1000) * 100) / 100;
  return {
    ...result,
    playingAtMs: firstPlaying.t,
    firstPlayingCur: firstPlaying.cur,
    startedAt,
    outcome: numberValue(firstPlaying.cur) > 2 ? "late-start" : "clean",
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor<T>(probe: () => Promise<T>, timeoutMs: number, intervalMs = 250) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await probe().catch((error: unknown) => ({ error: String(error) }));
    if (last && !(typeof last === "object" && "error" in last && last.error)) return last;
    await sleep(intervalMs);
  }
  throw new Error(`condition not met within ${timeoutMs}ms (last=${JSON.stringify(last)})`);
}

function relative(data: Record<string, unknown>, zero: number) {
  const shift = (entries: unknown[]) =>
    entries.map(record).map(({ at, doneAt, ...rest }) => ({ ms: numberValue(at) - zero, ...(doneAt ? { doneMs: numberValue(doneAt) - zero } : {}), ...rest }));
  return Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (!Array.isArray(value)) return [key, value];
      const first: unknown = value[0];
      return [key, first !== null && first !== undefined && Reflect.get(Object(first), "at") !== undefined ? shift(value) : value];
    })
  );
}

export async function instrumentPage(page: Page, options: { trapStore?: boolean } = {}) {
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
  navigate = isNAVIGATE,
}: {
  page: Page;
  collector: ReturnType<typeof createCollector>;
  runDir: string;
  emit: HarnessContext["emit"];
  step: HarnessContext["step"];
  ready: string;
  changeVideo: (videoId: string) => Promise<unknown>;
  next: () => Promise<unknown>;
  method?: string;
  trials?: number;
  settleMs?: number;
  navigate?: boolean;
}) {
  const results: (ReturnType<typeof classify> & { trial: number })[] = [];
  for (let trial = 0; trial <= trials; trial++) {
    await step(
      `first skip after load, trial ${trial}`,
      async () => {
        collector.reset();
        const loadAt = Date.now();
        if (trial > 0) {
          await page.send("Page.reload", {});
          await waitFor(async () => (numberValue(await page.evaluate("window.__fs ? window.__fs.t0 : 0")) > loadAt ? true : null), 60000);
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
            return now && record(now).videoId === VIDEO_ID && record(now).state === 1 && !record(now).ad ? now : null;
          }, 10000).catch((error: unknown) => {
            console.warn("first-skip: operation failed", error);
            return null;
          });
          attempts.push({
            attempt,
            sentMs,
            status,
            playing: !!playing,
            last:
              playing ??
              (await page.evaluate("window.__fs.read()").catch((error: unknown) => {
                console.warn("first-skip: operation failed", error);
                return null;
              })),
          });
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
          pressDocMs: record(record(armed).pre).docAgeMs,
          queueAtPress:
            record(record(armed).pre).queue &&
            `${String(record(record(record(armed).pre).queue).items)}+${String(record(record(record(armed).pre).queue).automix)}${record(record(record(armed).pre).queue).isGenerating ? " generating" : ""}`,
          counterpartMsAtPress: optionalRecord(record(record(armed).pre).counterpart)?.trackMs ?? null,
          ...classify(record(record(armed).pre), array(record(dump).samples).map(record)),
        };
        results.push(result);
        writeFileSync(
          path.join(runDir, `trial-${trial}.json`),
          JSON.stringify(
            {
              result,
              pre: record(armed).pre,
              commandMs,
              attempts,
              setupAfter: record(dump).setup,
              ua: record(dump).ua,
              docT0Ms: numberValue(record(dump).t0) - numberValue(record(armed).pressAt),
              samples: record(dump).samples,
              ...relative({ log: record(dump).log, ...trace }, numberValue(record(armed).pressAt)),
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

async function firstSkip(ctx: HarnessContext) {
  let token: string | undefined;
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
  ctx.emit("probe-first-skip-config", { method: METHOD, trials: TRIALS, pressAtS: PRESS_AT_S, settleMs: SETTLE_MS, navigate: isNAVIGATE, fixture });

  const command = (name: string, data?: unknown) =>
    ctx.companion.request("/api/v1/command", { method: "POST", token, body: data === undefined ? { command: name } : { command: name, data } });
  const results = await runFirstSkips({
    page,
    collector,
    runDir: ctx.runDir,
    emit: ctx.emit,
    step: ctx.step,
    ready: "!!window.__YTMD_HOOK__",
    changeVideo: (videoId) => command("changeVideo", { videoId }).then((res) => res.status),
    next: () => command("next"),
  });
  page.close();

  await ctx.step("every first skip landed on the next track from its start", () => {
    const counts = new Map<string, number>();
    for (const { trial, outcome } of results) if (trial > 0) counts.set(outcome, (counts.get(outcome) ?? 0) + 1);
    ctx.emit("probe-first-skip-summary", { launch: results[0]?.outcome, reloads: Object.fromEntries(counts) });
    if (results.some((result) => result.outcome !== "clean"))
      throw new Error(`launch ${results[0]?.outcome}, reloads ${JSON.stringify(Object.fromEntries(counts))}`);
  });
}

export { firstSkip as runScenario };
