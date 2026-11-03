import { app, ipcMain, screen, type BrowserWindow, type Session, type WebContents } from "electron";
import log from "electron-log";
import path from "path";
import { isRecord } from "~shared/unknown";
import { arrayOf, isString, objectOf } from "~shared/validation";

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

    if (process.env.YTMD_TEST && !process.env.YTMD_TEST_VISIBLE) {
      app.on("browser-window-created", (_event, window) => keepOffscreen(window));
      app.on("web-contents-created", (_event, contents) => {
        contents.openDevTools = () => undefined;
      });
    }

    if (process.env.YTMD_TEST) {
      ipcMain.on("ytmdTest:getBrokenHookStage", (event) => {
        event.returnValue = takeBrokenHookStage();
      });
    }
  }

  const runnerPid = Number(process.env.YTMD_TEST_RUNNER_PID);
  if (process.env.YTMD_TEST && runnerPid) {
    setInterval(() => {
      try {
        process.kill(runnerPid, 0);
      } catch {
        app.exit(43);
      }
    }, 5000);
  }
}

type DisplayBounds = { x: number; y: number; width: number; height: number };

export function offscreenOrigin(displays: DisplayBounds[], windowWidth: number): { x: number; y: number } {
  const left = Math.min(0, ...displays.map((bounds) => bounds.x));
  const top = Math.min(0, ...displays.map((bounds) => bounds.y));
  return { x: left - windowWidth - 400, y: top };
}

export function keepOffscreen(window: BrowserWindow, displays: () => DisplayBounds[] = () => screen.getAllDisplays().map((display) => display.bounds)) {
  const park = () => {
    const [width, height] = window.getSize();
    if (width === undefined || height === undefined) throw new Error("Window dimensions are unavailable");
    nativeSetBounds({ ...offscreenOrigin(displays(), width), width, height });
  };
  const nativeSetBounds = window.setBounds.bind(window);
  const nativeShowInactive = window.showInactive.bind(window);

  window.setSkipTaskbar(true);
  window.setBounds = (bounds) => {
    nativeSetBounds({ ...window.getBounds(), ...bounds });
    park();
  };
  window.setPosition = () => park();
  window.center = () => park();
  window.maximize = () => undefined;
  window.setFullScreen = () => undefined;
  window.focus = () => undefined;
  window.moveTop = () => undefined;
  window.setAlwaysOnTop = () => undefined;
  const show = () => {
    park();
    nativeShowInactive();
  };
  window.show = show;
  window.showInactive = show;
  window.on("move", () => {
    const bounds = window.getBounds();
    const isOnScreen = displays().some((display) => bounds.x + bounds.width > display.x && bounds.x < display.x + display.width);
    if (isOnScreen) park();
  });
  park();
}

export function isTestRun(): boolean {
  return !!process.env.YTMD_TEST;
}

export function isTestClient(): boolean {
  return !!process.env.YTMD_TEST || !!process.env.YTMD_TEST_PROFILE;
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
  const flags = new Map<string, boolean | string>();
  for (const pair of spec.split(",")) {
    const [name, value = "true"] = pair.split("=").map((part) => part.trim());
    if (!name) continue;
    flags.set(name, value === "true" ? true : value === "false" ? false : value);
  }
  return Object.fromEntries(flags);
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
  const injectResponse = async (params: unknown) => {
    if (!isRecord(params) || typeof params.requestId !== "string") return;
    try {
      const body: unknown = await debuggerSession.sendCommand("Fetch.getResponseBody", { requestId: params.requestId });
      if (!isRecord(body) || typeof body.body !== "string") throw new TypeError("YTM response body is invalid");
      const html = body.base64Encoded ? Buffer.from(body.body, "base64").toString("utf8") : body.body;
      const rewritten = injectYtmFlags(html, flags);
      log.info(`test-seams: YTM experiment flags ${spec} ${rewritten === html ? "not injected, no flag block" : "injected"}`);
      const responseHeaders = params.responseHeaders ?? [];
      if (!arrayOf(objectOf({ name: isString, value: isString }))(responseHeaders)) throw new TypeError("YTM response headers are invalid");
      const headers = responseHeaders.filter((header) => !/^content-(length|encoding)$/i.test(header.name));
      const responseCode = params.responseStatusCode ?? 200;
      if (typeof responseCode !== "number") throw new TypeError("YTM response status is invalid");
      await debuggerSession.sendCommand("Fetch.fulfillRequest", {
        requestId: params.requestId,
        responseCode,
        responseHeaders: headers,
        body: Buffer.from(rewritten, "utf8").toString("base64"),
      });
    } catch (error) {
      log.warn("test-seams: YTM experiment flag injection failed", error);
      void debuggerSession.sendCommand("Fetch.continueRequest", { requestId: params.requestId }).catch((error: unknown) => {
        log.warn("test-seams: operation failed", error);
        return undefined;
      });
    }
  };
  debuggerSession.on("message", (_event, method, params: unknown) => {
    if (method === "Fetch.requestPaused") void injectResponse(params).catch((error: unknown) => log.warn("test-seams: operation failed", error));
  });
  void debuggerSession
    .sendCommand("Fetch.enable", {
      patterns: [{ urlPattern: "https://music.youtube.com/*", resourceType: "Document", requestStage: "Response" }],
    })
    .catch((error: unknown) => log.warn("injectYtmExperimentFlags failed", error));
}

export function takeBrokenHookStage(): BreakableHookStage | null {
  if (!breakHooks) return null;
  const stage = breakHooks.stage;
  if (breakHooks.once) {
    breakHooks = null;
  }
  return stage;
}
