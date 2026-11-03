import { responseBody } from "../companion-values.ts";
import { numberValue, optionalRecord, record } from "../values.ts";
import type { HarnessContext } from "../run.ts";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { sampleTree, slope } from "../perf.ts";
import { hooksReadyStep, obtainCompanionToken, playbackFixture, roomIntegrationsFixture } from "./lib.ts";

export const needsCompanion = true;
export const fixture = {
  playback: playbackFixture({ adBlockerEnabled: false, preventIdlePause: true }),
  integrations: roomIntegrationsFixture({ companionServerEnabled: true }),
};

const VIDEO_ID = "dQw4w9WgXcQ";
const DRIFT_SECONDS = Number(process.env.YTMD_PERF_SECONDS) || 30;
const SAMPLE_INTERVAL_MS = (Number(process.env.YTMD_PERF_INTERVAL_SECONDS) || 10) * 1000;
const PROBE = "({ heap: (performance.memory && performance.memory.usedJSHeapSize) || null, nodes: document.getElementsByTagName('*').length })";

const mb = (bytes: number) => Math.round((bytes / 1048576) * 10) / 10;

type Sample = {
  at: number;
  label: string;
  processes: number;
  appRssMb: number;
  toolingRssMb: number;
  byTypeMb: Record<string, number>;
  mainHeapMb: number | null;
  mainNodes: number | null;
  ytmHeapMb: number | null;
  ytmNodes: number | null;
};

async function perfBaseline(ctx: HarnessContext) {
  const startedAt = Date.now();
  const phases = {};
  const samples: (Sample & { procs: { pid: number; type: string; rssMb: number }[] })[] = [];

  const probe = async (pattern: RegExp) => {
    try {
      const result = record(await ctx.evalOnTarget(pattern, PROBE));
      return { heap: result.heap === null ? null : numberValue(result.heap), nodes: numberValue(result.nodes) };
    } catch {
      return null;
    }
  };

  const takeSample = async (label: string): Promise<Sample> => {
    const tree = sampleTree(ctx.appPid);
    const [main, ytm] = await Promise.all([probe(ctx.patterns.MAIN_WINDOW), probe(ctx.patterns.YTM_VIEW)]);
    const sample = {
      at: Math.round((Date.now() - startedAt) / 1000),
      label,
      processes: tree.count,
      appRssMb: mb(tree.appRss),
      toolingRssMb: mb(tree.toolingRss),
      byTypeMb: Object.fromEntries(Object.entries(tree.byType).map(([k, v]) => [k, mb(v)])),
      mainHeapMb: optionalRecord(main)?.heap ? mb(numberValue(record(main).heap)) : null,
      mainNodes: main?.nodes ?? null,
      ytmHeapMb: optionalRecord(ytm)?.heap ? mb(numberValue(record(ytm).heap)) : null,
      ytmNodes: ytm?.nodes ?? null,
    };
    samples.push({ ...sample, procs: tree.processes.map((p) => ({ pid: p.pid, type: p.type, rssMb: mb(p.rss) })) });
    ctx.emit("perf-sample", sample);
    return sample;
  };

  await ctx.step(
    "ytm view target present",
    async () => {
      await ctx.waitTarget(ctx.patterns.YTM_VIEW, 90000);
      record(phases).ytmViewTargetMs = Date.now() - startedAt;
    },
    95000
  );

  await hooksReadyStep(ctx);
  record(phases).hooksReadyMs = Date.now() - startedAt;

  await ctx.step("sample at idle", () => takeSample("idle"));

  let token: string | undefined;
  await ctx.step(
    "obtain token",
    async () => {
      token = await obtainCompanionToken(ctx);
    },
    90000
  );

  await ctx.step("player volume floored", async () => {
    const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "setVolume", data: 0 } });
    if (res.status !== 204) throw new Error(`setVolume returned ${res.status}`);
  });

  await ctx.step(
    "playback reaches steady state",
    async () => {
      const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "changeVideo", data: { videoId: VIDEO_ID } } });
      if (res.status !== 204) throw new Error(`changeVideo returned ${res.status}`);
      const deadline = Date.now() + 90000;
      let previousProgress = null;
      let last = null;
      while (Date.now() < deadline) {
        const state = await ctx.companion.request("/api/v1/state", { token });
        const player = responseBody(state.body)?.player;
        const loadedId = responseBody(state.body)?.video?.id;
        const progress = player?.videoProgress ?? 0;
        last = { loadedId, trackState: player?.trackState, progress, adPlaying: player?.adPlaying };
        if (loadedId === VIDEO_ID) {
          if (player?.adPlaying === true || (previousProgress !== null && progress > previousProgress)) {
            record(phases).playingMs = Date.now() - startedAt;
            return;
          }
          if (previousProgress !== null && progress === previousProgress) {
            await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "play" } });
          }
          previousProgress = progress;
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      throw new Error(`requested track never advanced: ${JSON.stringify(last)}`);
    },
    95000
  );

  await ctx.step("sample at playback start", () => takeSample("playing"));

  const driftMs = DRIFT_SECONDS * 1000;
  await ctx.step(
    `steady-state drift over ${DRIFT_SECONDS}s`,
    async () => {
      const deadline = Date.now() + driftMs;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, Math.min(SAMPLE_INTERVAL_MS, deadline - Date.now())));
        await takeSample("drift");
      }
    },
    driftMs + 120000
  );

  const final = await takeSample("final");
  const drift = samples.filter((s) => s.label !== "idle");

  const report = {
    scenario: "perf-baseline",
    startedAt: new Date(startedAt).toISOString(),
    driftSeconds: DRIFT_SECONDS,
    note: "dev run via electron-forge start; tooling RSS is vite+forge and is not part of the shipped app",
    phases,
    summary: {
      idleAppRssMb: samples[0]?.appRssMb ?? null,
      finalAppRssMb: final.appRssMb,
      peakAppRssMb: Math.max(...samples.map((s) => s.appRssMb)),
      processes: final.processes,
      byTypeMb: final.byTypeMb,
      slopesMeaningful: DRIFT_SECONDS >= 120,
      appRssSlopeMbPerMin: DRIFT_SECONDS < 120 ? null : Math.round(slope(drift, (s) => s.appRssMb) * 10) / 10,
      mainHeapSlopeMbPerMin: DRIFT_SECONDS < 120 ? null : Math.round(slope(drift, (s) => Number(s.mainHeapMb)) * 10) / 10,
      ytmNodeSlopePerMin: DRIFT_SECONDS < 120 ? null : Math.round(slope(drift, (s) => Number(s.ytmNodes))),
    },
    samples,
  };

  writeFileSync(path.join(ctx.runDir, "perf.json"), JSON.stringify(report, null, 2));
  ctx.emit("perf-report", report.summary);
}

export { perfBaseline as runScenario };
