import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchState, ListenAlongError, pair, sampleFromRemoteState } from "../src/main/integrations/listen-along/client";
import { VideoState } from "../src/shared/addons/sdk";

vi.mock("electron-log", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("listen along response boundaries", () => {
  it.each([undefined, null, {}, { player: null, video: null }])("keeps empty state defaults for %j", (state) => {
    expect(sampleFromRemoteState(state, 100)).toEqual({
      videoId: null,
      durationSeconds: 0,
      progress: 0,
      trackState: VideoState.Unknown,
      adPlaying: false,
      asOfMs: 100,
    });
  });

  it("passes the pairing code through and returns the token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: "123456" }))
      .mockResolvedValueOnce(Response.json({ token: "paired-token" }));
    vi.stubGlobal("fetch", fetchMock);
    const onCode = vi.fn<(code: string) => void>();
    await expect(pair("host", 9863, "26.11.3", onCode)).resolves.toBe("paired-token");
    expect(onCode).toHaveBeenCalledWith("123456");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "http://host:9863/api/v1/auth/request",
      expect.objectContaining({
        body: JSON.stringify({ appId: "ytmdplus_listenalong", code: "123456" }),
      })
    );
  });

  it.each([null, {}, { code: 123456 }])("rejects an invalid pairing code %j", async (body) => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(Response.json(body)));
    await expect(pair("host", 9863, "26.11.3", vi.fn())).rejects.toThrow("Host returned an invalid pairing code");
  });

  it("keeps the host sample and bounded latency estimate", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValueOnce(300);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          player: { trackState: VideoState.Playing, videoProgress: 42, adPlaying: false },
          video: { id: "track", durationSeconds: 200 },
        })
      )
    );
    await expect(fetchState("host", 9863, "token")).resolves.toEqual({
      oneWayMs: 100,
      sample: { videoId: "track", durationSeconds: 200, progress: 42, trackState: VideoState.Playing, adPlaying: false, asOfMs: 200 },
    });
  });

  it("keeps the connection error and its cause", async () => {
    const cause = new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(cause));
    await expect(fetchState("host", 9863, "token")).rejects.toEqual(
      new ListenAlongError("Can't reach host - check the host is running and its firewall allows the connection", { cause })
    );
  });
});
