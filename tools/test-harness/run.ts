import type { ChildProcess } from "node:child_process";
import { record } from "./values.ts";
import { readScenario } from "./scenario.ts";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createEmitter } from "./events.ts";
import { cloneProfile, launchApp, REPO_ROOT } from "./launch.ts";
import { createStoreDefaults } from "../../src/shared/store/defaults.mts";
import { RUNS_DIR, sweep, listStrays, teardown } from "./teardown.ts";
import { devToolsActivePort, inspectorPort, listTargets, evalOnTarget, matchedStylesOnTarget, screenshotOnTarget, waitForTarget, waitForValue } from "./cdp.ts";
import * as companion from "./companion.ts";
import { createLogTail, grepFile } from "./log-tail.ts";

const MAIN_WINDOW = /windows\/main\/index\.html/;
const YTM_VIEW = /music\.youtube\.com|consent\.youtube\.com|accounts\.google\.com/;

const readText = (file: string) => {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
};

export class EnvironmentBlocked extends Error {
  override name = "EnvironmentBlocked";
}
class StepFailed extends Error {
  override name = "StepFailed";
}

const args = process.argv.slice(2);
const scenarioName = args[0];
const timeoutSeconds = Number(args[args.indexOf("--timeout") + 1]) || 300;
const repoRootIndex = args.indexOf("--repo-root");
const repoRoot = repoRootIndex >= 0 ? args[repoRootIndex + 1] : undefined;
if (!scenarioName) {
  console.error("usage: node tools/test-harness/run.ts <scenario> [--timeout seconds]");
  process.exit(2);
}

const scenario = readScenario(await import(`./scenarios/${scenarioName}.ts`));
const startedAt = Date.now();
const stamp = new Date(startedAt).toISOString().replaceAll(/[:.]/g, "-").slice(0, 19);
const runDir = path.join(RUNS_DIR, `${stamp}-${scenarioName}`);
const profileDir = path.join(runDir, "profile");
mkdirSync(profileDir, { recursive: true });
const { emit, lastEvent } = createEmitter(path.join(runDir, "runner.jsonl"), startedAt);
const forgeLog = path.join(runDir, "forge.log");
const mainLog = path.join(profileDir, "logs", "main.log");

let phase = "prelaunch";
let child: ChildProcess | null = null;
let logTail: ReturnType<typeof createLogTail> | null = null;
let unexpectedTrip: string | null = null;

const expectedTripwires = new Set(scenario.expectedTripwires ?? []);

async function evidence() {
  const data: { phase: string; strays: number; targets?: string[] | string; memoryStore?: unknown; mainLogTail?: string } = {
    phase,
    strays: listStrays().length,
  };
  try {
    data.targets = (await listTargets(cdpPort)).map((t) => `${t.type}: ${t.url.slice(0, 70)}`);
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

async function finish(code: number, verdict: string, extra: Record<string, unknown> = {}) {
  clearInterval(heartbeat);
  clearTimeout(watchdog);
  logTail?.stop();
  emit("verdict", { verdict, exitCode: code, ...extra });
  const isClean = await teardown(child, emit);
  process.exit(isClean ? code : Math.max(code, 6));
}

let cdpPort: number | null = null;
let inspectPort: number | null = null;

emit("run-start", { scenario: scenarioName, runDir, timeoutSeconds });

const sweptBefore = sweep();
if (sweptBefore.length) emit("prelaunch-sweep", { killed: sweptBefore });

if (scenario.needsCompanion && (await companion.portInUse())) {
  emit("environment-blocked", { reason: "companion port 9863 already in use (another instance running?)" });
  process.exit(5);
}

const seedProfile = process.env.YTMD_SEED_PROFILE;
if (seedProfile) {
  cloneProfile(path.resolve(seedProfile), profileDir);
  const configPath = path.join(profileDir, "config.json");
  let seededConfig: Record<string, unknown> | undefined;
  try {
    seededConfig = record(JSON.parse(readFileSync(configPath, "utf8")));
  } catch (error) {
    console.warn("run: operation failed", error);
  }
  const merged = new Map(Object.entries(seededConfig ?? {}));
  for (const [section, values] of Object.entries(scenario.fixture ?? {})) {
    merged.set(section, values && typeof values === "object" && !Array.isArray(values) ? { ...record(seededConfig?.[section] ?? {}), ...values } : values);
  }
  writeFileSync(configPath, JSON.stringify(Object.fromEntries(merged), null, 2));
  emit("profile-seeded", { from: seedProfile });
} else {
  const packageData = record(JSON.parse(readFileSync(path.join(repoRoot ?? REPO_ROOT, "package.json"), "utf8")));
  if (typeof packageData.version !== "string") throw new Error("Package version is missing");
  const defaults = createStoreDefaults(packageData.version);
  const fixture = new Map<string, unknown>(Object.entries(defaults));
  for (const [section, values] of Object.entries(scenario.fixture ?? {})) {
    const previous = fixture.get(section);
    fixture.set(section, values && typeof values === "object" && !Array.isArray(values) ? { ...record(previous ?? {}), ...values } : values);
  }
  writeFileSync(path.join(profileDir, "config.json"), JSON.stringify(Object.fromEntries(fixture), null, 2));
  writeFileSync(path.join(profileDir, ".first-run"), "");
}

if (scenario.prepareProfile) await scenario.prepareProfile(profileDir);

async function expireWatchdog() {
  emit("watchdog", await evidence());
  await finish(4, "watchdog-timeout");
}

const watchdog = setTimeout(() => {
  void expireWatchdog().catch((error: unknown) => console.warn("Harness watchdog failed", error));
}, timeoutSeconds * 1000);

const heartbeat = setInterval(() => {
  emit("heartbeat", { phase, elapsed: Math.round((Date.now() - startedAt) / 1000), lastEvent: lastEvent() });
}, 15000);

logTail = createLogTail({
  files: () => [forgeLog, mainLog],
  emit,
  matchers: [/\[ytmd\]/, /hook failed/i, /Integration enabled/],
  tripwires: [
    { name: "crash", pattern: /Crashed|Application crashed/ },
    { name: "port-conflict", pattern: /EADDRINUSE/ },
    { name: "hook-failed", pattern: /hook failed at stage/ },
  ],
  onTrip: (name) => {
    if (!expectedTripwires.has(name)) unexpectedTrip = name;
  },
});

phase = "launch";
child = launchApp({ profileDir, inspect: !!scenario.inspectMain, logPath: forgeLog, env: scenario.env ?? {}, repoRoot });
emit("launched", { pid: child.pid });
child.on("exit", (code) => emit("app-process-exit", { code }));

const appChild = child;

const ctx = {
  emit,
  runDir,
  profileDir,
  mainLog,
  get cdpPort() {
    return cdpPort;
  },
  appPid: child.pid,
  companion,
  patterns: { MAIN_WINDOW, YTM_VIEW },
  environmentBlocked: (reason: string) => {
    throw new EnvironmentBlocked(reason);
  },
  evalMain: (expr: string) => evalOnTarget(cdpPort, MAIN_WINDOW, expr),
  evalMainProcess: (expr: string) => evalOnTarget(inspectPort, /^file:/, expr),
  evalYtm: (expr: string) => evalOnTarget(cdpPort, /music\.youtube\.com/, expr),
  matchedStylesYtm: (selectors: string[]) => matchedStylesOnTarget(cdpPort, YTM_VIEW, selectors),
  screenshotYtm: () => screenshotOnTarget(cdpPort, YTM_VIEW),
  waitMain: (expr: string, predicate: (value: unknown) => boolean, timeoutMs: number) => waitForValue(cdpPort, MAIN_WINDOW, expr, predicate, timeoutMs),
  waitYtm: (expr: string, predicate: (value: unknown) => boolean, timeoutMs: number) =>
    waitForValue(cdpPort, /music\.youtube\.com/, expr, predicate, timeoutMs),
  waitTarget: (pattern: RegExp, timeoutMs: number) => waitForTarget(cdpPort, pattern, timeoutMs),
  evalOnTarget: (pattern: RegExp, expr: string) => evalOnTarget(cdpPort, pattern, expr),
  waitOnTarget: (pattern: RegExp, expr: string, predicate: (value: unknown) => boolean, timeoutMs: number) =>
    waitForValue(cdpPort, pattern, expr, predicate, timeoutMs),
  grepMainLog: (pattern: RegExp) => grepFile(mainLog, pattern),
  waitAppExit: (timeoutMs: number) =>
    new Promise<number | null>((resolve, reject) => {
      if (appChild.exitCode !== null) {
        resolve(appChild.exitCode);
        return;
      }
      const timer = setTimeout(() => reject(new Error(`app process still running after ${timeoutMs}ms`)), timeoutMs);
      appChild.once("exit", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    }),
  waitMainLog: async (pattern: RegExp, timeoutMs: number) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const line = grepFile(mainLog, pattern);
      if (line) return line;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`log line ${pattern} not found within ${timeoutMs}ms`);
  },
  step: async <T>(name: string, fn: () => T | Promise<T>, timeoutMs = 30000) => {
    if (unexpectedTrip) throw new StepFailed(`tripwire fired: ${unexpectedTrip}`);
    phase = `step:${name}`;
    emit("step-start", { name });
    try {
      const result = await Promise.race([
        fn(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`step timed out after ${timeoutMs}ms`)), timeoutMs)),
      ]);
      emit("step-pass", { name });
      return result;
    } catch (error) {
      if (error instanceof EnvironmentBlocked) throw error;
      emit("step-fail", { name, error: String(error) });
      throw new StepFailed(String(error));
    }
  },
};

export type HarnessContext = typeof ctx;

try {
  phase = "cdp";
  await ctx.step(
    "app boots and cdp answers",
    async () => {
      const deadline = Date.now() + 120000;
      for (;;) {
        if (child.exitCode !== null) throw new Error(`app process exited early with code ${child.exitCode}`);
        const port = devToolsActivePort(readText(path.join(profileDir, "DevToolsActivePort")));
        const inspect = scenario.inspectMain ? inspectorPort(grepFile(forgeLog, /Debugger listening on/)) : null;
        if (
          port &&
          (inspect || !scenario.inspectMain) &&
          (await listTargets(port).then(
            () => true,
            () => false
          ))
        ) {
          cdpPort = port;
          inspectPort = inspect;
          emit("cdp-ports", { cdpPort, inspectPort });
          return;
        }
        if (Date.now() > deadline) throw new Error(`cdp never became reachable (DevToolsActivePort ${port ?? "missing"}, inspector ${inspect ?? "n/a"})`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    },
    125000
  );

  phase = "audio-mute";
  await ctx.step(
    "audio output is muted",
    async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        if (grepFile(forgeLog, /test-seams: audio output muted/)) return;
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error("app never confirmed the audio mute; refusing to run so nothing plays at full volume");
    },
    35000
  );

  phase = "main-window";
  await ctx.step("main window appears", () => waitForTarget(cdpPort, MAIN_WINDOW, 60000), 65000);

  phase = "scenario";
  await scenario.runScenario(ctx);
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
