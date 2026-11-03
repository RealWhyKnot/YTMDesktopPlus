export async function runScript(request: unknown) {
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  const endpoint = isRecord(request) ? request.endpoint : undefined;
  if (typeof endpoint !== "string" || !/^[a-z0-9_]+(\/[a-z0-9_]+)*$/.test(endpoint)) throw new Error("invalid innertube endpoint");
  const yt: unknown = Reflect.get(window, "yt");
  const cfg = isRecord(yt) ? yt.config_ : undefined;
  if (!isRecord(cfg) || !cfg.INNERTUBE_CONTEXT) throw new Error("innertube config unavailable");
  const sapisid = /(?:^|; )SAPISID=([^;]+)/.exec(document.cookie);
  if (!sapisid?.[1]) throw new Error("not signed in");

  const ts = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${ts} ${sapisid[1]} https://music.youtube.com`));
  const hash = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const sessionIndex = cfg.SESSION_INDEX;
  const authUser = String(sessionIndex);
  const response = await fetch("/youtubei/v1/" + endpoint + "?prettyPrint=false", {
    signal: AbortSignal.timeout(30_000),
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Authorization: `SAPISIDHASH ${ts}_${hash}`,
      "X-Origin": "https://music.youtube.com",
      "X-Goog-AuthUser": sessionIndex === null || sessionIndex === undefined ? "0" : authUser,
    },
    body: JSON.stringify(Object.assign({ context: cfg.INNERTUBE_CONTEXT }, isRecord(request) ? request.body : undefined)),
  });
  if (!response.ok) throw new Error(`${endpoint} request failed: http ${response.status}`);
  const body: unknown = await response.json();
  return body;
}
