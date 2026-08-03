import { app } from "electron";
import path from "path";

// Development and test-run seams, all opt-in through environment variables.
// This module must run before anything reads userData (logging, the single
// instance lock, the config store), so it is imported first from the main
// entry point.

export type BreakableHookStage = "store-hook" | "player-api";

let breakHooks: { stage: BreakableHookStage; once: boolean } | null = null;

export function initializeTestSeams() {
  const profile = process.env.YTMD_TEST_PROFILE;
  if (profile) {
    app.setPath("userData", profile);
    app.setPath("sessionData", profile);
    app.setAppLogsPath(path.join(profile, "logs"));
  }

  if (!app.isPackaged) {
    const cdpPort = process.env.YTMD_TEST_CDP_PORT;
    if (cdpPort) {
      app.commandLine.appendSwitch("remote-debugging-port", cdpPort);
    }

    const breakSpec = process.env.YTMD_TEST_BREAK_HOOKS;
    if (breakSpec) {
      const [stage, modifier] = breakSpec.split(":");
      if (stage === "store-hook" || stage === "player-api") {
        breakHooks = { stage, once: modifier === "once" };
      }
    }
  }

  const runnerPid = Number(process.env.YTMD_TEST_RUNNER_PID);
  if (process.env.YTMD_TEST && runnerPid) {
    // Watch the test runner's process. If the runner dies for any reason the
    // app exits with it, so runs can never leave an orphaned instance behind.
    // (Stdin cannot carry this signal: Windows GUI processes do not reliably
    // inherit console pipe handles.)
    setInterval(() => {
      try {
        process.kill(runnerPid, 0);
      } catch {
        app.exit(43);
      }
    }, 5000);
  }
}

export function isTestRun(): boolean {
  return !!process.env.YTMD_TEST;
}

// Returns the hook stage the current YTM view creation should break, consuming
// it when it was declared with the :once modifier so a view recreation (the
// Retry path) recovers.
export function takeBrokenHookStage(): BreakableHookStage | null {
  if (!breakHooks) return null;
  const stage = breakHooks.stage;
  if (breakHooks.once) {
    breakHooks = null;
  }
  return stage;
}
