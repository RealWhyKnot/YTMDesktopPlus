import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProcesses } from "./perf.mjs";

// Process cleanup for test runs. Layered: graceful stdin close first, then a
// tree kill, then a sweep that finds re-parented orphans by command line, then
// a verification pass. The same sweep runs before launch so a run never
// coexists with leftovers from a previous one.

const ps = script => {
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 20000 });
  } catch {
    return "";
  }
};

export const RUNS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "runs") + path.sep;

export function selectStrays(rows, runsDir) {
  const scope = runsDir.toLowerCase();
  return rows.filter(row => {
    const name = String(row.Name).toLowerCase();
    const commandLine = String(row.CommandLine ?? "").toLowerCase();
    return commandLine.includes(scope) && (name === "electron.exe" || (name === "node.exe" && commandLine.includes("electron-forge")));
  });
}

export function listStrays() {
  return selectStrays(readProcesses(), RUNS_DIR).map(row => ({ pid: row.ProcessId, name: row.Name }));
}

export function sweep() {
  const strays = listStrays();
  if (strays.length) {
    ps(`Stop-Process -Id ${strays.map(stray => stray.pid).join(",")} -Force -ErrorAction SilentlyContinue`);
  }
  return strays;
}

export async function teardown(child, emit) {
  // 1. Graceful: the app and forge both exit when this pipe closes.
  try {
    child?.stdin?.end();
  } catch {
    // stdin may already be gone
  }
  const gracefulDeadline = Date.now() + 5000;
  while (child && child.exitCode === null && Date.now() < gracefulDeadline) {
    await new Promise(r => setTimeout(r, 250));
  }

  // 2. Tree kill for anything the graceful path missed.
  if (child?.pid) {
    try {
      execFileSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { timeout: 15000 });
    } catch {
      // Already exited is the common case here.
    }
  }

  // 3. Sweep re-parented orphans, then verify everything is dead.
  sweep();
  const verifyDeadline = Date.now() + 10000;
  while (Date.now() < verifyDeadline) {
    const strays = listStrays();
    if (strays.length === 0) {
      emit?.("teardown-complete", {});
      return true;
    }
    sweep();
    await new Promise(r => setTimeout(r, 1000));
  }
  emit?.("teardown-verify-failed", { strays: listStrays() });
  return false;
}
