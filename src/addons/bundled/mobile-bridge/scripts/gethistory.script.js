// Reads the head of the account's listening history straight from InnerTube
// with the page's own session config and the same authorization the page
// computes for its own calls. A track playing on any device on the account
// reaches this list within seconds of starting (measured 2026-08-11); the
// page's yt-service-request bus does not serve browse endpoints, which is why
// this goes direct. Read-only: it never joins, claims or controls a session.
(async function () {
  const cfg = window.yt && window.yt.config_;
  if (!cfg || !cfg.INNERTUBE_CONTEXT) throw new Error("innertube config unavailable");
  const sapisid = document.cookie.match(/(?:^|; )SAPISID=([^;]+)/);
  if (!sapisid) throw new Error("not signed in");

  const ts = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sapisid[1] + " https://music.youtube.com"));
  const hash = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const response = await fetch("/youtubei/v1/browse?prettyPrint=false", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: "SAPISIDHASH " + ts + "_" + hash,
      "X-Origin": "https://music.youtube.com",
      "X-Goog-AuthUser": String(cfg.SESSION_INDEX != null ? cfg.SESSION_INDEX : 0)
    },
    body: JSON.stringify({ context: cfg.INNERTUBE_CONTEXT, browseId: "FEmusic_history" })
  });
  if (!response.ok) throw new Error("history request failed: http " + response.status);
  const data = await response.json();

  const items = [];
  const runsText = runs => (runs || []).map(r => r.text).join("");
  const visit = node => {
    if (!node || typeof node !== "object" || items.length >= 3) return;
    if (Array.isArray(node)) {
      for (const n of node) visit(n);
      return;
    }
    const item = node.musicResponsiveListItemRenderer;
    if (item) {
      const columns = (item.flexColumns || []).map(c =>
        runsText(c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text && c.musicResponsiveListItemFlexColumnRenderer.text.runs)
      );
      const thumbnails =
        (item.thumbnail && item.thumbnail.musicThumbnailRenderer && item.thumbnail.musicThumbnailRenderer.thumbnail && item.thumbnail.musicThumbnailRenderer.thumbnail.thumbnails) || [];
      items.push({
        videoId: (item.playlistItemData && item.playlistItemData.videoId) || null,
        title: columns[0] || "",
        author: columns[1] || "",
        thumbnailUrl: thumbnails.length ? thumbnails[thumbnails.length - 1].url : null
      });
      return;
    }
    for (const value of Object.values(node)) visit(value);
  };
  visit(data);
  return items.filter(item => item.videoId);
});
