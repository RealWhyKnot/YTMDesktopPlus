import { afterEach, describe, expect, it, vi } from "vitest";
import { blockWatchHistoryWrites, WATCH_HISTORY_WRITES } from "../src/main/test-seams";

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
