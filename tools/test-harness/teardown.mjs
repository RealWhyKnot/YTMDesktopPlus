import { execFileSync } from "node:child_process";

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

// Matches the processes a dev run can create: the app itself, forge/vite node
// processes, and shells wrapping yarn start. Excludes this runner and its
// harness peers.
const SWEEP_QUERY = `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'electron.exe') -or ($_.Name -eq 'node.exe' -and ($_.CommandLine -like '*electron-forge*' -or $_.CommandLine -like '*vite*') -and $_.CommandLine -notlike '*test-harness*') -or ($_.Name -eq 'cmd.exe' -and $_.CommandLine -like '*yarn start*') } | Where-Object { $_.ProcessId -ne ${process.pid} }`;

export function listStrays() {
  const out = ps(`${SWEEP_QUERY} | ForEach-Object { "$($_.ProcessId)|$($_.Name)" }`);
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => {
      const [pid, name] = line.split("|");
      return { pid: Number(pid), name };
    });
}

export function sweep() {
  const strays = listStrays();
  if (strays.length) {
    ps(`${SWEEP_QUERY} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`);
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
