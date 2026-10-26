import { afterEach, describe, expect, it, vi } from "vitest";
import {
  blockWatchHistoryWrites,
  injectYtmExperimentFlags,
  injectYtmFlags,
  keepOffscreen,
  offscreenOrigin,
  parseYtmFlagSpec,
  WATCH_HISTORY_WRITES
} from "../src/main/test-seams";

function fakeSession() {
  const onBeforeSendHeaders = vi.fn();
  return { session: { webRequest: { onBeforeSendHeaders } } as never, onBeforeSendHeaders };
}

describe("blockWatchHistoryWrites", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("leaves a normal launch alone", () => {
    vi.stubEnv("YTMD_TEST", "");
    vi.stubEnv("YTMD_TEST_PROFILE", "");
    const { session, onBeforeSendHeaders } = fakeSession();

    blockWatchHistoryWrites(session);

    expect(onBeforeSendHeaders).not.toHaveBeenCalled();
  });

  it.each([
    ["YTMD_TEST", "1"],
    ["YTMD_TEST_PROFILE", String.raw`C:\profiles\smoke`]
  ])("cancels the playback and watchtime pings when %s is set", (variable, value) => {
    vi.stubEnv(variable, value);
    const { session, onBeforeSendHeaders } = fakeSession();

    blockWatchHistoryWrites(session);

    const [filter, listener] = onBeforeSendHeaders.mock.calls[0];
    expect(filter).toEqual({ urls: WATCH_HISTORY_WRITES });
    for (const url of ["https://music.youtube.com/api/stats/playback?docid=dQw4w9WgXcQ", "https://music.youtube.com/api/stats/watchtime?docid=dQw4w9WgXcQ"]) {
      const callback = vi.fn();
      listener({ url }, callback);
      expect(callback).toHaveBeenCalledWith({ cancel: true });
    }
  });
});

describe("YTM experiment flag injection", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses a flag spec into booleans and strings", () => {
    expect(parseYtmFlagSpec("music_web_enable_wiz_miniplayer, other=false,level=3,")).toEqual({
      music_web_enable_wiz_miniplayer: true,
      other: false,
      level: "3"
    });
  });

  it("buckets every EXPERIMENT_FLAGS block in the page into the experiment", () => {
    const html = '<script>ytcfg.set({"EXPERIMENT_FLAGS":{"ab_det_apm":true}});</script><script>ytcfg.set({"EXPERIMENT_FLAGS":{}});</script>';
    const rewritten = injectYtmFlags(html, { music_web_enable_wiz_miniplayer: true });
    expect(rewritten).toBe(
      '<script>ytcfg.set({"EXPERIMENT_FLAGS":{"music_web_enable_wiz_miniplayer":true,"ab_det_apm":true}});</script><script>ytcfg.set({"EXPERIMENT_FLAGS":{"music_web_enable_wiz_miniplayer":true,}});</script>'
    );
    expect(injectYtmFlags(html, {})).toBe(html);
  });

  it("never attaches a debugger outside a test run", () => {
    vi.stubEnv("YTMD_TEST", "");
    vi.stubEnv("YTMD_TEST_YTM_FLAGS", "music_web_enable_wiz_miniplayer");
    const attach = vi.fn();
    injectYtmExperimentFlags({ debugger: { attach, on: vi.fn(), sendCommand: vi.fn() } } as never);
    expect(attach).not.toHaveBeenCalled();
  });
});

describe("keepOffscreen", () => {
  const displays = [
    { x: 0, y: 0, width: 2560, height: 1440 },
    { x: -1920, y: -200, width: 1920, height: 1080 }
  ];

  function fakeWindow() {
    let bounds = { x: 100, y: 100, width: 1280, height: 720 };
    const listeners: Record<string, () => void> = {};
    const calls = { showInactive: 0, skipTaskbar: false };
    const window = {
      getSize: () => [bounds.width, bounds.height],
      getBounds: () => ({ ...bounds }),
      setBounds: (next: typeof bounds) => {
        bounds = { ...bounds, ...next };
        listeners.move?.();
      },
      showInactive: () => {
        calls.showInactive++;
      },
      setSkipTaskbar: (skip: boolean) => {
        calls.skipTaskbar = skip;
      },
      on: (event: string, listener: () => void) => {
        listeners[event] = listener;
      }
    } as Record<string, unknown>;
    return { window, calls, bounds: () => bounds };
  }

  const clearOfEveryDisplay = (bounds: { x: number; width: number }) =>
    displays.every(display => bounds.x + bounds.width <= display.x || bounds.x >= display.x + display.width);

  it("parks left of the leftmost display", () => {
    expect(offscreenOrigin(displays, 1280)).toEqual({ x: -1920 - 1280 - 400, y: -200 });
    expect(offscreenOrigin([{ x: 0, y: 0, width: 1920, height: 1080 }], 800)).toEqual({ x: -1200, y: 0 });
  });

  it("shows without focus, off the taskbar and off every display", () => {
    const { window, calls, bounds } = fakeWindow();
    keepOffscreen(window as never, () => displays);

    (window.show as () => void)();
    (window.focus as () => void)();
    (window.maximize as () => void)();
    (window.moveTop as () => void)();

    expect(calls.showInactive).toBe(1);
    expect(calls.skipTaskbar).toBe(true);
    expect(bounds().width).toBe(1280);
    expect(clearOfEveryDisplay(bounds())).toBe(true);
  });

  it("keeps the size the app asks for but never its position", () => {
    const { window, bounds } = fakeWindow();
    keepOffscreen(window as never, () => displays);

    (window.setBounds as (next: object) => void)({ x: 50, y: 50, width: 900, height: 600 });
    expect(bounds().width).toBe(900);
    expect(bounds().height).toBe(600);
    expect(clearOfEveryDisplay(bounds())).toBe(true);

    (window.setPosition as (x: number, y: number) => void)(10, 10);
    (window.center as () => void)();
    expect(clearOfEveryDisplay(bounds())).toBe(true);
  });
});
