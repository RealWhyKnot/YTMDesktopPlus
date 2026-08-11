// Scenario runner for development test runs.
//
//   node tools/test-harness/run.mjs <scenario> [--timeout <seconds>]
//
// Design rules:
// - Real time: every step and state change is one JSON line on stdout the
//   moment it happens, with a heartbeat naming the current phase, so a silent
//   stall is always visible.
// - Bounded: each phase and step carries its own deadline under one global
//   watchdog. The run always terminates with a verdict and an exit code.
// - Isolated: every run gets a fresh profile directory (own config, cookies,
//   logs, single-instance lock) and a swept process table.
// - Clean: teardown closes the held stdin pipe (which the app and forge both
//   exit on), tree-kills the remainder, sweeps re-parented orphans, and
//   verifies nothing survived.
//
// Exit codes: 0 pass, 2 step failed, 3 launch failed, 4 watchdog, 5
// environment blocked (companion port busy, consent wall), 6 teardown could
// not verify a clean process table.

import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createEmitter } from "./events.mjs";
import { launchApp } from "./launch.mjs";
import { sweep, listStrays, teardown } from "./teardown.mjs";
import { listTargets, evalOnTarget, waitForTarget, waitForValue } from "./cdp.mjs";
import * as companion from "./companion.mjs";
import { createLogTail, grepFile } from "./log-tail.mjs";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const MAIN_WINDOW = /windows\/main\/index\.html/;
const YTM_VIEW = /music\.youtube\.com|consent\.youtube\.com|accounts\.google\.com/;

export class EnvironmentBlocked extends Error {}
class StepFailed extends Error {}

const args = process.argv.slice(2);
const scenarioName = args[0];
const timeoutSeconds = Number(args[args.indexOf("--timeout") + 1]) || 300;
if (!scenarioName) {
  console.error("usage: node tools/test-harness/run.mjs <scenario> [--timeout seconds]");
  process.exit(2);
}

const scenario = await import(`./scenarios/${scenarioName}.mjs`);
const startedAt = Date.now();
const stamp = new Date(startedAt)
  .toISOString()
  .replaceAll(/[:.]/g, "-")
  .slice(0, 19);
const runDir = path.join(HARNESS_DIR, "runs", `${stamp}-${scenarioName}`);
const profileDir = path.join(runDir, "profile");
mkdirSync(profileDir, { recursive: true });
const { emit, lastEvent } = createEmitter(path.join(runDir, "runner.jsonl"), startedAt);
const forgeLog = path.join(runDir, "forge.log");
const mainLog = path.join(profileDir, "logs", "main.log");

let phase = "prelaunch";
let child = null;
let logTail = null;
let heartbeat = null;
let watchdog = null;
let unexpectedTrip = null;

const expectedTripwires = new Set(scenario.expectedTripwires ?? []);

async function evidence() {
  const data = { phase, strays: listStrays().length };
  try {
    data.targets = (await listTargets(cdpPort)).map(t => `${t.type}: ${t.url.slice(0, 70)}`);
  } catch {
    data.targets = "cdp unreachable";
  }
  try {
    data.memoryStore = await evalOnTarget(
      cdpPort,
      MAIN_WINDOW,
      `Promise.all([
        window.ytmd.memoryStore.get('ytmViewLoading'),
        window.ytmd.memoryStore.get('ytmViewLoadingError'),
        window.ytmd.memoryStore.get('ytmViewLoadingStatus')
      ]).then(([loading, error, status]) => ({ loading, error, status }))`
    );
  } catch {
    data.memoryStore = "unreachable";
  }
  data.mainLogTail = grepFile(mainLog, /error|failed/i) ?? "(no error lines)";
  return data;
}

async function finish(code, verdict, extra = {}) {
  clearInterval(heartbeat);
  clearTimeout(watchdog);
  logTail?.stop();
  emit("verdict", { verdict, exitCode: code, ...extra });
  const clean = await teardown(child, emit);
  process.exit(clean ? code : Math.max(code, 6));
}

// Pick a CDP port nothing is listening on.
let cdpPort = 9333;
for (; cdpPort < 9343; cdpPort++) {
  try {
    await listTargets(cdpPort);
  } catch {
    break;
  }
}

emit("run-start", { scenario: scenarioName, runDir, cdpPort, timeoutSeconds });

const sweptBefore = sweep();
if (sweptBefore.length) emit("prelaunch-sweep", { killed: sweptBefore });

if (scenario.needsCompanion && (await companion.portInUse())) {
  emit("environment-blocked", { reason: "companion port 9863 already in use (another instance running?)" });
  process.exit(5);
}

// YTMD_SEED_PROFILE clones an existing profile directory (cookies, storage,
// config) into the run so a scenario can act against a signed-in state. The
// scenario fixture still wins key-by-key over the seeded config, and the
// first-run marker is skipped: a seeded profile is not a first run.
const seedProfile = process.env.YTMD_SEED_PROFILE;
if (seedProfile) {
  cpSync(seedProfile, profileDir, { recursive: true });
  const configPath = path.join(profileDir, "config.json");
  let seededConfig = {};
  try {
    seededConfig = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    // no or unreadable config in the seed; the fixture alone applies
  }
  const merged = { ...seededConfig };
  for (const [section, values] of Object.entries(scenario.fixture ?? {})) {
    merged[section] =
      values && typeof values === "object" && !Array.isArray(values) ? { ...(seededConfig[section] ?? {}), ...values } : values;
  }
  writeFileSync(configPath, JSON.stringify(merged, null, 2));
  emit("profile-seeded", { from: seedProfile });
} else {
  writeFileSync(path.join(profileDir, "config.json"), JSON.stringify(scenario.fixture ?? {}, null, 2));
  writeFileSync(path.join(profileDir, ".first-run"), "");
}

watchdog = setTimeout(async () => {
  emit("watchdog", await evidence());
  await finish(4, "watchdog-timeout");
}, timeoutSeconds * 1000);

heartbeat = setInterval(() => {
  emit("heartbeat", { phase, elapsed: Math.round((Date.now() - startedAt) / 1000), lastEvent: lastEvent() });
}, 15000);

logTail = createLogTail({
  files: () => [forgeLog, mainLog],
  emit,
  matchers: [/\[ytmd\]/, /hook failed/i, /Integration enabled/],
  tripwires: [
    { name: "crash", pattern: /Crashed|Application crashed/ },
    { name: "port-conflict", pattern: /EADDRINUSE/ },
    { name: "hook-failed", pattern: /hook failed at stage/ }
  ],
  onTrip: name => {
    if (!expectedTripwires.has(name)) unexpectedTrip = name;
  }
});

phase = "launch";
child = launchApp({ profileDir, cdpPort, logPath: forgeLog, env: scenario.env ?? {} });
emit("launched", { pid: child.pid });
child.on("exit", code => emit("app-process-exit", { code }));

const ctx = {
  emit,
  runDir,
  profileDir,
  mainLog,
  cdpPort,
  companion,
  patterns: { MAIN_WINDOW, YTM_VIEW },
  environmentBlocked: reason => {
    throw new EnvironmentBlocked(reason);
  },
  evalMain: expr => evalOnTarget(cdpPort, MAIN_WINDOW, expr),
  evalYtm: expr => evalOnTarget(cdpPort, /music\.youtube\.com/, expr),
  waitMain: (expr, predicate, timeoutMs) => waitForValue(cdpPort, MAIN_WINDOW, expr, predicate, timeoutMs),
  waitYtm: (expr, predicate, timeoutMs) => waitForValue(cdpPort, /music\.youtube\.com/, expr, predicate, timeoutMs),
  waitTarget: (pattern, timeoutMs) => waitForTarget(cdpPort, pattern, timeoutMs),
  evalOnTarget: (pattern, expr) => evalOnTarget(cdpPort, pattern, expr),
  waitOnTarget: (pattern, expr, predicate, timeoutMs) => waitForValue(cdpPort, pattern, expr, predicate, timeoutMs),
  grepMainLog: pattern => grepFile(mainLog, pattern),
  waitMainLog: async (pattern, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const line = grepFile(mainLog, pattern);
      if (line) return line;
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error(`log line ${pattern} not found within ${timeoutMs}ms`);
  },
  step: async (name, fn, timeoutMs = 30000) => {
    if (unexpectedTrip) throw new StepFailed(`tripwire fired: ${unexpectedTrip}`);
    phase = `step:${name}`;
    emit("step-start", { name });
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`step timed out after ${timeoutMs}ms`)), timeoutMs))
      ]);
      emit("step-pass", { name });
      return result;
    } catch (error) {
      if (error instanceof EnvironmentBlocked) throw error;
      emit("step-fail", { name, error: String(error) });
      throw new StepFailed(String(error));
    }
  }
};

try {
  phase = "cdp";
  await ctx.step(
    "app boots and cdp answers",
    async () => {
      const deadline = Date.now() + 120000;
      for (;;) {
        if (child.exitCode !== null) throw new Error(`app process exited early with code ${child.exitCode}`);
        try {
          await listTargets(cdpPort);
          return;
        } catch {
          if (Date.now() > deadline) throw new Error("cdp never became reachable");
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    },
    125000
  );

  phase = "main-window";
  await ctx.step("main window appears", () => waitForTarget(cdpPort, MAIN_WINDOW, 60000), 65000);

  phase = "scenario";
  await scenario.default(ctx);
  await finish(0, "pass");
} catch (error) {
  if (error instanceof EnvironmentBlocked) {
    emit("environment-blocked", { reason: error.message });
    await finish(5, "environment-blocked");
  } else {
    emit("run-failed", { error: String(error), ...(await evidence()) });
    await finish(2, "fail");
  }
}
