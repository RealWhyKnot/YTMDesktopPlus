import { spawn } from "node:child_process";
import { openSync } from "node:fs";
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
export function launchApp({ profileDir, cdpPort, logPath, env = {} }) {
  const forgeStart = path.join(REPO_ROOT, "node_modules", "@electron-forge", "cli", "dist", "electron-forge-start.js");
  const fd = openSync(logPath, "w");
  const child = spawn(process.execPath, [forgeStart], {
    cwd: REPO_ROOT,
    stdio: ["pipe", fd, fd],
    env: {
      ...process.env,
      NODE_ENV: "development",
      YTMD_TEST: "1",
      YTMD_TEST_RUNNER_PID: String(process.pid),
      YTMD_TEST_PROFILE: profileDir,
      YTMD_TEST_CDP_PORT: String(cdpPort),
      ...env
    }
  });
  child.stdin.on("error", () => {
    // The pipe closing during teardown is expected.
  });
  return child;
}

export { REPO_ROOT };
