import { spawn } from "node:child_process";
import { cpSync, openSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureCssOptions } from "./css-capture.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function launchApp({
  profileDir,
  inspect = false,
  logPath,
  env = {},
  repoRoot = REPO_ROOT,
}: {
  profileDir: string;
  inspect?: boolean;
  logPath: string;
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
}) {
  const forgeStart = path.join(repoRoot, "node_modules", "@electron-forge", "cli", "dist", "electron-forge-start.js");
  const fd = openSync(logPath, "w");
  const nodeOptions = env.YTMD_TEST_CAPTURE_CSS === "1" ? captureCssOptions(profileDir, process.env.NODE_OPTIONS) : process.env.NODE_OPTIONS;
  const args = [forgeStart, "--", "--disable-features=CalculateNativeWinOcclusion", `--user-data-dir=${profileDir}`, ...(inspect ? ["--inspect=0"] : [])];
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    stdio: ["pipe", fd, fd],
    env: {
      ...process.env,
      NODE_ENV: "development",
      YTMD_TEST_RUNNER_PID: String(process.pid),
      YTMD_TEST_PROFILE: profileDir,
      YTMD_TEST_CDP_PORT: "0",
      ...env,
      NODE_OPTIONS: nodeOptions,
      YTMD_TEST: "1",
      YTMD_TEST_ALLOW_AUDIO: "",
      YTMD_TEST_MUTED: "1",
    },
  });
  child.stdin?.on("error", () => {
    return undefined;
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
  "DevToolsActivePort",
]);

export function cloneProfile(seedRoot: string, profileDir: string) {
  cpSync(seedRoot, profileDir, {
    recursive: true,
    filter: (source) => !SEED_SKIP.has(path.basename(source)) || path.dirname(path.resolve(source)) !== seedRoot,
  });
}

export { REPO_ROOT };
