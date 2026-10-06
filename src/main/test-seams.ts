import { app, ipcMain, type Session, type WebContents } from "electron";
import log from "electron-log";
import path from "path";

// Development and test-run seams, all opt-in through environment variables.
// This module must run before anything reads userData (logging, the single
// instance lock, the config store), so it is imported first from the main
// entry point.

export type BreakableHookStage = "store-hook" | "player-api";

export const AUDIO_MUTED_MARKER = "test-seams: audio output muted";

let breakHooks: { stage: BreakableHookStage; once: boolean } | null = null;

export function initializeTestSeams() {
  const profile = process.env.YTMD_TEST_PROFILE;
  if (profile) {
    app.setPath("userData", profile);
    app.setPath("sessionData", profile);
    app.setAppLogsPath(path.join(profile, "logs"));
  }

  if (!process.env.YTMD_TEST_ALLOW_AUDIO && isTestClient()) {
    app.commandLine.appendSwitch("mute-audio");
    app.on("web-contents-created", (_event, contents) => {
      contents.setAudioMuted(true);
      contents.on("did-finish-load", () => contents.setAudioMuted(true));
    });
    console.log(AUDIO_MUTED_MARKER);
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

    if (process.env.YTMD_TEST) {
      // The YTM view preload asks for its broken stage synchronously at
      // startup. This must be per-request rather than an additionalArguments
      // switch: renderer processes can be reused across view recreations,
      // which would resurrect a consumed break flag from the old argv.
      ipcMain.on("ytmdTest:getBrokenHookStage", event => {
        event.returnValue = takeBrokenHookStage();
      });
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

export function isTestClient(): boolean {
  return !!(process.env.YTMD_TEST || process.env.YTMD_TEST_PROFILE);
}

export const WATCH_HISTORY_WRITES = ["*://*.youtube.com/api/stats/playback*", "*://*.youtube.com/api/stats/watchtime*"];

export function blockWatchHistoryWrites(ytmSession: Session) {
  if (!isTestClient()) return;

  const logged = new Set<string>();
  ytmSession.webRequest.onBeforeSendHeaders({ urls: WATCH_HISTORY_WRITES }, (details, callback) => {
    const endpoint = new URL(details.url).pathname;
    if (!logged.has(endpoint)) {
      logged.add(endpoint);
      log.info(`test-seams: blocked watch history write ${endpoint}`);
    }
    callback({ cancel: true });
  });
}

export function parseYtmFlagSpec(spec: string): Record<string, boolean | string> {
  const flags: Record<string, boolean | string> = {};
  for (const pair of spec.split(",")) {
    const [name, value = "true"] = pair.split("=").map(part => part.trim());
    if (!name) continue;
    flags[name] = value === "true" ? true : value === "false" ? false : value;
  }
  return flags;
}

export function injectYtmFlags(html: string, flags: Record<string, boolean | string>): string {
  const injected = JSON.stringify(flags).slice(1, -1);
  if (!injected) return html;
  return html.replaceAll('"EXPERIMENT_FLAGS":{', `"EXPERIMENT_FLAGS":{${injected},`);
}

export function injectYtmExperimentFlags(contents: WebContents) {
  const spec = process.env.YTMD_TEST_YTM_FLAGS;
  if (!spec || !isTestRun() || app.isPackaged) return;

  const flags = parseYtmFlagSpec(spec);
  const debuggerSession = contents.debugger;
  debuggerSession.attach("1.3");
  debuggerSession.on("message", async (_event, method, params) => {
    if (method !== "Fetch.requestPaused") return;
    try {
      const body = await debuggerSession.sendCommand("Fetch.getResponseBody", { requestId: params.requestId });
      const html = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body;
      const rewritten = injectYtmFlags(html, flags);
      log.info(`test-seams: YTM experiment flags ${spec} ${rewritten === html ? "not injected, no flag block" : "injected"}`);
      const headers = (params.responseHeaders ?? []).filter((header: { name: string }) => !/^content-(length|encoding)$/i.test(header.name));
      await debuggerSession.sendCommand("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode: params.responseStatusCode ?? 200,
        responseHeaders: headers,
        body: Buffer.from(rewritten, "utf8").toString("base64")
      });
    } catch (error) {
      log.warn("test-seams: YTM experiment flag injection failed", error);
      debuggerSession.sendCommand("Fetch.continueRequest", { requestId: params.requestId }).catch((): undefined => undefined);
    }
  });
  debuggerSession.sendCommand("Fetch.enable", {
    patterns: [{ urlPattern: "https://music.youtube.com/*", resourceType: "Document", requestStage: "Response" }]
  });
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
