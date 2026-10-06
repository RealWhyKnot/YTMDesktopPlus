import { afterEach, describe, expect, it, vi } from "vitest";
import { blockWatchHistoryWrites, injectYtmExperimentFlags, injectYtmFlags, parseYtmFlagSpec, WATCH_HISTORY_WRITES } from "../src/main/test-seams";

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
