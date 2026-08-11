// Developer diagnostics only. Compiled out of published builds via the
// YTMD_DEV_TOOLS flag and dormant unless launched with YTMD_REMOTE_PROBE=1.
//
// Runs in the YouTube Music main world and reports, as batches to the main
// process, every signal that could reveal playback starting on another device
// on the same account: outgoing network endpoints (which InnerTube calls the
// page makes and how often), page action names, popups, changes to the store's
// cast slice, and a periodic history browse. Read-only: it observes and, for
// history, issues the same read the account page already makes; it never joins,
// claims or controls a session.
(function () {
  const queue = [];
  let flushTimer = null;
  const flush = () => {
    flushTimer = null;
    if (queue.length === 0) return;
    try {
      window.ytmd.sendDevProbe(queue.splice(0, queue.length));
    } catch {
      queue.length = 0;
    }
  };
  const push = (type, data) => {
    queue.push({ t: Date.now(), type, ...data });
    if (!flushTimer) flushTimer = setTimeout(flush, 1000);
  };

  const seenEndpoints = new Set();
  const noteUrl = (raw, via) => {
    let url;
    try {
      url = String(raw);
    } catch {
      return;
    }
    let pathname = url;
    try {
      pathname = new URL(url, location.href).pathname;
    } catch {
      // relative or malformed; keep the raw string as the path
    }
    const isApi = /\/youtubei\/v1\//.test(url);
    // Every distinct API endpoint is worth one line; non-API resources are
    // deduped by path so the log is not drowned by images and styles.
    const key = via + "|" + pathname + (isApi ? "|" + url.split("?")[0] : "");
    if (seenEndpoints.has(key)) return;
    seenEndpoints.add(key);
    push("net", { via, pathname, api: isApi, url: url.slice(0, 300) });
  };

  for (const entry of performance.getEntriesByType("resource")) noteUrl(entry.name, "preload");

  const originalFetch = window.fetch;
  window.fetch = function (...args) {
    try {
      noteUrl(args[0] && args[0].url ? args[0].url : args[0], "fetch");
    } catch {
      // recording only
    }
    return originalFetch.apply(this, args);
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      noteUrl(url, "xhr");
    } catch {
      // recording only
    }
    return originalOpen.call(this, method, url, ...rest);
  };

  window.WebSocket = new Proxy(window.WebSocket, {
    construct(target, args) {
      try {
        push("ws", { url: String(args[0]).slice(0, 300) });
      } catch {
        // recording only
      }
      return new target(...args);
    }
  });

  if (window.EventSource) {
    window.EventSource = new Proxy(window.EventSource, {
      construct(target, args) {
        try {
          push("sse", { url: String(args[0]).slice(0, 300) });
        } catch {
          // recording only
        }
        return new target(...args);
      }
    });
  }

  document.addEventListener("yt-action", event => {
    const name = event.detail && event.detail.actionName;
    if (name) push("action", { name });
  });
  document.addEventListener("yt-popup-opened", event => {
    push("popup", { nodeName: (event.detail && event.detail.nodeName) || null });
  });

  // The store already knows when the client is bumped by another device (that
  // is what raises the interruption popup), so watch the slices most likely to
  // carry it and report each change.
  try {
    const store = window.__YTMD_HOOK__ && window.__YTMD_HOOK__.ytmStore;
    if (store) {
      let prevCast = "";
      let prevPlayerFlags = "";
      store.subscribe(() => {
        const state = store.getState() || {};
        const cast = JSON.stringify(state.castStatus || null);
        if (cast !== prevCast) {
          prevCast = cast;
          push("store", { slice: "castStatus", value: state.castStatus || null });
        }
        const player = state.player || {};
        const flags = JSON.stringify({
          playerPageOpen: state.playerPage && state.playerPage.playerPageOpen,
          trackState: player.trackState,
          adPlaying: player.adPlaying
        });
        if (flags !== prevPlayerFlags) {
          prevPlayerFlags = flags;
          push("store", { slice: "player", value: JSON.parse(flags) });
        }
      });
    }
  } catch {
    // store not hookable; the network tap still runs
  }

  // Periodic account-history browse straight against InnerTube with the
  // page's own session config and the same authorization header the page
  // computes for its own calls. The yt-service-request bus does not serve
  // browse endpoints, so this goes direct. Head entries reveal what most
  // recently played on any device and let us measure how fast a phone track
  // appears here.
  const pollHistory = async () => {
    try {
      const cfg = window.yt && window.yt.config_;
      if (!cfg || !cfg.INNERTUBE_CONTEXT) {
        push("history", { error: "no innertube config" });
        return;
      }
      const sapisid = document.cookie.match(/(?:^|; )SAPISID=([^;]+)/);
      if (!sapisid) {
        push("history", { error: "no SAPISID cookie" });
        return;
      }
      const ts = Math.floor(Date.now() / 1000);
      const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(ts + " " + sapisid[1] + " https://music.youtube.com"));
      const hash = Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      const response = await originalFetch.call(window, "/youtubei/v1/browse?prettyPrint=false", {
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
      if (!response.ok) {
        push("history", { error: "http " + response.status });
        return;
      }
      await response.json().then(
        data => {
          const items = [];
          const runsText = runs => (runs || []).map(r => r.text).join("");
          const visit = node => {
            if (!node || typeof node !== "object" || items.length >= 8) return;
            if (Array.isArray(node)) {
              for (const n of node) visit(n);
              return;
            }
            const item = node.musicResponsiveListItemRenderer;
            if (item) {
              items.push({
                videoId: (item.playlistItemData && item.playlistItemData.videoId) || null,
                columns: (item.flexColumns || []).map(c =>
                  runsText(c.musicResponsiveListItemFlexColumnRenderer && c.musicResponsiveListItemFlexColumnRenderer.text && c.musicResponsiveListItemFlexColumnRenderer.text.runs)
                )
              });
              return;
            }
            for (const value of Object.values(node)) visit(value);
          };
          visit(data);
          push("history", { head: items.slice(0, 5) });
        },
        error => push("history", { error: String((error && error.errorMessage) || error) })
      );
    } catch (error) {
      push("history", { error: String(error) });
    }
  };

  setInterval(pollHistory, 15000);
  pollHistory();
  push("probe-started", { href: location.href });
});
