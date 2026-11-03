import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import type { Emit } from "./events.ts";
import type { ProcessRow } from "./perf.ts";
import { readProcesses } from "./perf.ts";

const ps = (script: string) => {
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: 20000 });
  } catch {
    return "";
  }
};

export const RUNS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "runs") + path.sep;

export function selectStrays<T extends ProcessRow>(rows: T[], runsDir: string) {
  const scope = runsDir.toLowerCase();
  return rows.filter((row) => {
    const name = row.Name.toLowerCase();
    const commandLine = (row.CommandLine ?? "").toLowerCase();
    return commandLine.includes(scope) && (name === "electron.exe" || (name === "node.exe" && commandLine.includes("electron-forge")));
  });
}

export function listStrays() {
  return selectStrays(readProcesses(), RUNS_DIR).map((row) => ({ pid: row.ProcessId, name: row.Name }));
}

export function sweep() {
  const strays = listStrays();
  if (strays.length) {
    ps(`Stop-Process -Id ${strays.map((stray) => stray.pid).join(",")} -Force -ErrorAction SilentlyContinue`);
  }
  return strays;
}

export async function teardown(child: ChildProcess | null, emit?: Emit) {
  try {
    child?.stdin?.end();
  } catch (error) {
    console.warn("teardown: operation failed", error);
  }
  const gracefulDeadline = Date.now() + 5000;
  while (child?.exitCode === null && Date.now() < gracefulDeadline) {
    await new Promise((r) => setTimeout(r, 250));
  }

  if (child?.pid) {
    try {
      execFileSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { timeout: 15000 });
    } catch (error) {
      console.warn("teardown: operation failed", error);
    }
  }

  sweep();
  const verifyDeadline = Date.now() + 10000;
  while (Date.now() < verifyDeadline) {
    const strays = listStrays();
    if (strays.length === 0) {
      emit?.("teardown-complete", {});
      return true;
    }
    sweep();
    await new Promise((r) => setTimeout(r, 1000));
  }
  emit?.("teardown-verify-failed", { strays: listStrays() });
  return false;
}
