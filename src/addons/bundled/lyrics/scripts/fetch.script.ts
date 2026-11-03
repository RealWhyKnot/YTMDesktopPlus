export async function runScript(request: unknown) {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  function at(value: unknown, ...keys: string[]): unknown {
    for (const key of keys) value = isRecord(value) ? value[key] : undefined;
    return value;
  }
  function array(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
  }
  function textRuns(value: unknown): string {
    return array(value)
      .map((run) => at(run, "text"))
      .join("");
  }
  const videoId = at(request, "videoId");
  if (typeof videoId !== "string" || !/^[\w-]{6,20}$/.test(videoId)) throw new Error("invalid video id");
  const yt: unknown = Reflect.get(window, "yt");
  const cfg = at(yt, "config_");
  if (!isRecord(cfg) || !cfg.INNERTUBE_CONTEXT) throw new Error("innertube config unavailable");

  const post = async (endpoint: string, body: Record<string, unknown>, client?: Record<string, unknown>): Promise<unknown> => {
    const context: unknown = JSON.parse(JSON.stringify(cfg.INNERTUBE_CONTEXT));
    if (client) {
      if (!isRecord(context) || !isRecord(context.client)) throw new Error("innertube client config unavailable");
      Object.assign(context.client, client);
    }
    const response = await fetch("/youtubei/v1/" + endpoint + "?prettyPrint=false", {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ context: context }, body)),
    });
    if (!response.ok) throw new Error(`${endpoint} request failed: http ${response.status}`);
    return await response.json();
  };

  const next = await post("next", { videoId: videoId });
  const tabs = array(at(next, "contents", "singleColumnMusicWatchNextResultsRenderer", "tabbedRenderer", "watchNextTabbedResultsRenderer", "tabs"));
  let browseId: string | null = null;
  for (const tab of tabs) {
    const endpoint = at(tab, "tabRenderer", "endpoint", "browseEndpoint");
    const config = at(endpoint, "browseEndpointContextSupportedConfigs", "browseEndpointContextMusicConfig");
    if (at(config, "pageType") === "MUSIC_PAGE_TYPE_TRACK_LYRICS" && isRecord(endpoint) && typeof endpoint.browseId === "string") browseId = endpoint.browseId;
  }
  if (!browseId) return { videoId: videoId, lines: null, source: null };

  const browse = await post("browse", { browseId: browseId }, { clientName: "ANDROID_MUSIC", clientVersion: "7.21.50" });
  const data = at(browse, "contents", "elementRenderer", "newElement", "type", "componentType", "model", "timedLyricsModel", "lyricsData");
  const sourceMessage = at(data, "sourceMessage");
  const mobileSource = typeof sourceMessage === "string" ? sourceMessage : null;
  const timedLines = array(at(data, "timedLyricsData"));
  if (timedLines.some((line) => at(line, "cueRange"))) {
    return { videoId: videoId, lines: timedLines, source: mobileSource };
  }

  const web = await post("browse", { browseId: browseId }).catch((error: unknown) => {
    console.warn("fetch.script: operation failed", error);
    return null;
  });
  const shelf = array(at(web, "contents", "sectionListRenderer", "contents"));
  for (const item of shelf) {
    const description = at(item, "musicDescriptionShelfRenderer");
    if (!description) continue;
    const text = textRuns(at(description, "description", "runs"));
    const footer = textRuns(at(description, "footer", "runs"));
    if (text) return { videoId: videoId, lines: text.split("\n").map((line) => ({ lyricLine: line })), source: footer || mobileSource };
  }
  if (timedLines.length > 0) return { videoId: videoId, lines: timedLines, source: mobileSource };
  return { videoId: videoId, lines: null, source: null };
}
