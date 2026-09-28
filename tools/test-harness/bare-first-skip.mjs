import { execFileSync, spawn } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { waitForTarget } from "./cdp.mjs";
import { cloneProfile } from "./launch.mjs";
import { attachPage, instrumentPage, runFirstSkips } from "./scenarios/first-skip.mjs";

const HARNESS_DIR = path.dirname(fileURLToPath(import.meta.url));
const CDP_PORT = 9350;

const seedProfile = process.env.YTMD_SEED_PROFILE;
if (!seedProfile) {
  console.error("usage: YTMD_SEED_PROFILE=<signed-in profile dir> node tools/test-harness/bare-first-skip.mjs");
  process.exit(2);
}

const startedAt = Date.now();
const stamp = new Date(startedAt).toISOString().replaceAll(/[:.]/g, "-").slice(0, 19);
const runDir = path.join(HARNESS_DIR, "runs", `${stamp}-bare-first-skip`);
const profileDir = path.join(runDir, "profile");
mkdirSync(profileDir, { recursive: true });
cloneProfile(path.resolve(seedProfile), profileDir);

const emit = (event, data = {}) => console.log(JSON.stringify({ t: Number(((Date.now() - startedAt) / 1000).toFixed(1)), event, ...data }));
const log = openSync(path.join(runDir, "electron.log"), "w");
const child = spawn(electronPath, [path.join(HARNESS_DIR, "bare-main.mjs")], {
  env: { ...process.env, YTMD_BARE_PROFILE: profileDir, YTMD_BARE_CDP_PORT: String(CDP_PORT) },
  stdio: ["ignore", log, log]
});
emit("launched", { pid: child.pid, runDir });

const step = async (name, fn, timeoutMs) => {
  emit("step-start", { name });
  const result = await Promise.race([fn(), new Promise((_, reject) => setTimeout(() => reject(new Error(`step timed out after ${timeoutMs}ms`)), timeoutMs))]);
  emit("step-pass", { name });
  return result;
};

let exitCode = 0;
try {
  await waitForTarget(CDP_PORT, /music\.youtube\.com/, 120000);
  const page = await attachPage(CDP_PORT);
  const collector = await instrumentPage(page, { trapStore: true });
  const results = await runFirstSkips({
    page,
    collector,
    runDir,
    emit,
    step,
    ready: `window.__fs.api() !== document.querySelector("#movie_player")`,
    changeVideo: videoId =>
      page.evaluate(
        `document.dispatchEvent(new CustomEvent("yt-navigate", { detail: { endpoint: { watchEndpoint: { videoId: ${JSON.stringify(videoId)} } } } })), 204`
      ),
    next: () => Promise.reject(new Error("companion presses need the app"))
  });
  page.close();
  const counts = {};
  for (const { trial, outcome } of results) if (trial > 0) counts[outcome] = (counts[outcome] ?? 0) + 1;
  emit("summary", { launch: results[0]?.outcome, reloads: counts });
} catch (error) {
  exitCode = 2;
  emit("run-failed", { error: String(error) });
} finally {
  try {
    execFileSync("taskkill", ["/T", "/F", "/PID", String(child.pid)]);
  } catch {
    exitCode = Math.max(exitCode, 6);
  }
}
process.exit(exitCode);
