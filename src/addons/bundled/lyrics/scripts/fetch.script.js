(async function (request) {
  const videoId = request && request.videoId;
  if (typeof videoId !== "string" || !/^[\w-]{6,20}$/.test(videoId)) throw new Error("invalid video id");
  const cfg = window.yt && window.yt.config_;
  if (!cfg || !cfg.INNERTUBE_CONTEXT) throw new Error("innertube config unavailable");

  const post = async (endpoint, body, client) => {
    const context = JSON.parse(JSON.stringify(cfg.INNERTUBE_CONTEXT));
    if (client) Object.assign(context.client, client);
    const response = await fetch("/youtubei/v1/" + endpoint + "?prettyPrint=false", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ context: context }, body))
    });
    if (!response.ok) throw new Error(endpoint + " request failed: http " + response.status);
    return await response.json();
  };

  const next = await post("next", { videoId: videoId });
  const tabs =
    (next &&
      next.contents &&
      next.contents.singleColumnMusicWatchNextResultsRenderer &&
      next.contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer &&
      next.contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer &&
      next.contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer.tabs) ||
    [];
  let browseId = null;
  for (const tab of tabs) {
    const endpoint = tab && tab.tabRenderer && tab.tabRenderer.endpoint && tab.tabRenderer.endpoint.browseEndpoint;
    const config =
      endpoint && endpoint.browseEndpointContextSupportedConfigs && endpoint.browseEndpointContextSupportedConfigs.browseEndpointContextMusicConfig;
    if (config && config.pageType === "MUSIC_PAGE_TYPE_TRACK_LYRICS" && typeof endpoint.browseId === "string") browseId = endpoint.browseId;
  }
  if (!browseId) return { videoId: videoId, lines: null, source: null };

  const browse = await post("browse", { browseId: browseId }, { clientName: "ANDROID_MUSIC", clientVersion: "7.21.50" });
  const element = browse && browse.contents && browse.contents.elementRenderer;
  const model =
    element && element.newElement && element.newElement.type && element.newElement.type.componentType && element.newElement.type.componentType.model;
  const data = model && model.timedLyricsModel && model.timedLyricsModel.lyricsData;
  const mobileSource = data && typeof data.sourceMessage === "string" ? data.sourceMessage : null;
  if (data && Array.isArray(data.timedLyricsData) && data.timedLyricsData.some(line => line && line.cueRange)) {
    return { videoId: videoId, lines: data.timedLyricsData, source: mobileSource };
  }

  const web = await post("browse", { browseId: browseId }).catch(() => null);
  const shelf = web && web.contents && web.contents.sectionListRenderer && web.contents.sectionListRenderer.contents;
  for (const item of shelf || []) {
    const description = item && item.musicDescriptionShelfRenderer;
    if (!description) continue;
    const text = ((description.description && description.description.runs) || []).map(run => run.text).join("");
    const footer = ((description.footer && description.footer.runs) || []).map(run => run.text).join("");
    if (text) return { videoId: videoId, lines: text.split("\n").map(line => ({ lyricLine: line })), source: footer || mobileSource };
  }
  if (data && Array.isArray(data.timedLyricsData) && data.timedLyricsData.length > 0)
    return { videoId: videoId, lines: data.timedLyricsData, source: mobileSource };
  return { videoId: videoId, lines: null, source: null };
});
