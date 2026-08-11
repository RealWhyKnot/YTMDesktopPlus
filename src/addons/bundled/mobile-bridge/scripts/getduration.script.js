// Looks up one track's duration from InnerTube with the page's own session,
// for history rows that carry none. Called at most once per mirrored track;
// the caller caches the answer. Takes a videoId, resolves seconds or null.
(async function (videoId) {
  if (!videoId) return null;
  const cfg = window.yt && window.yt.config_;
  if (!cfg || !cfg.INNERTUBE_CONTEXT) throw new Error("innertube config unavailable");
  const sapisid = document.cookie.match(/(?:^|; )SAPISID=([^;]+)/);
  if (!sapisid) throw new Error("not signed in");

  const ts = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sapisid[1] + " https://music.youtube.com"));
  const hash = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const response = await fetch("/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: "SAPISIDHASH " + ts + "_" + hash,
      "X-Origin": "https://music.youtube.com",
      "X-Goog-AuthUser": String(cfg.SESSION_INDEX != null ? cfg.SESSION_INDEX : 0)
    },
    body: JSON.stringify({ context: cfg.INNERTUBE_CONTEXT, videoId: videoId })
  });
  if (!response.ok) throw new Error("player request failed: http " + response.status);
  const data = await response.json();
  const length = data && data.videoDetails && Number(data.videoDetails.lengthSeconds);
  return Number.isFinite(length) && length > 0 ? length : null;
});
