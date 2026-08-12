// InnerTube (music.youtube.com/youtubei/v1) with the page's own session
// config and the same authorization the page computes for its own calls. The
// page's yt-service-request bus does not serve browse endpoints, which is why
// this goes direct. Takes { endpoint, body }, resolves the parsed response.
(async function (request) {
  const endpoint = request && request.endpoint;
  if (typeof endpoint !== "string" || !/^[a-z0-9_]+(\/[a-z0-9_]+)*$/.test(endpoint)) throw new Error("invalid innertube endpoint");
  const cfg = window.yt && window.yt.config_;
  if (!cfg || !cfg.INNERTUBE_CONTEXT) throw new Error("innertube config unavailable");
  const sapisid = document.cookie.match(/(?:^|; )SAPISID=([^;]+)/);
  if (!sapisid) throw new Error("not signed in");

  const ts = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sapisid[1] + " https://music.youtube.com"));
  const hash = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");

  const response = await fetch("/youtubei/v1/" + endpoint + "?prettyPrint=false", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: "SAPISIDHASH " + ts + "_" + hash,
      "X-Origin": "https://music.youtube.com",
      "X-Goog-AuthUser": String(cfg.SESSION_INDEX != null ? cfg.SESSION_INDEX : 0)
    },
    body: JSON.stringify(Object.assign({ context: cfg.INNERTUBE_CONTEXT }, (request && request.body) || {}))
  });
  if (!response.ok) throw new Error(endpoint + " request failed: http " + response.status);
  return await response.json();
});
