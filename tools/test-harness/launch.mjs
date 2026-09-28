import { spawn } from "node:child_process";
import { cpSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// Launches `electron-forge start` by spawning its CLI script with the current
// node executable directly: no cmd/corepack/yarn layers in the process tree,
// so teardown has exactly one child to manage.
//
// stdin is a pipe this runner holds open for the whole run. Forge dies when
// its stdin closes, and the app's test seam exits when the inherited stdin
// closes, so if this runner dies for any reason the whole tree follows.
// Nothing is ever written to it: forge treats input as the restart command.
export function launchApp({ profileDir, inspect = false, logPath, env = {} }) {
  const forgeStart = path.join(REPO_ROOT, "node_modules", "@electron-forge", "cli", "dist", "electron-forge-start.js");
  const fd = openSync(logPath, "w");
  const args = [forgeStart, "--", "--disable-features=CalculateNativeWinOcclusion", `--user-data-dir=${profileDir}`, ...(inspect ? ["--inspect=0"] : [])];
  const child = spawn(process.execPath, args, {
    cwd: REPO_ROOT,
    stdio: ["pipe", fd, fd],
    env: {
      ...process.env,
      NODE_ENV: "development",
      YTMD_TEST_RUNNER_PID: String(process.pid),
      YTMD_TEST_PROFILE: profileDir,
      YTMD_TEST_CDP_PORT: "0",
      ...env,
      YTMD_TEST: "1",
      YTMD_TEST_ALLOW_AUDIO: ""
    }
  });
  child.stdin.on("error", () => {
    // The pipe closing during teardown is expected.
  });
  return child;
}

const SEED_SKIP = new Set([
  "Session Storage",
  "blob_storage",
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "Crashpad",
  "logs",
  "DIPS",
  "DIPS-wal",
  "DevToolsActivePort"
]);

export function cloneProfile(seedRoot, profileDir) {
  cpSync(seedRoot, profileDir, { recursive: true, filter: source => !SEED_SKIP.has(path.basename(source)) || path.dirname(path.resolve(source)) !== seedRoot });
}

export { REPO_ROOT };
