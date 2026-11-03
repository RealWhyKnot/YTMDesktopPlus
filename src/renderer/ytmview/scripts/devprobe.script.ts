import { pageRecord, pageMember, pageArray, pageCall } from "./page-values";

export function runScript() {
  const pageWindow: Omit<Window, "EventSource"> & { EventSource?: typeof EventSource } = window;
  const bridge: unknown = Reflect.get(window, "ytmd");
  const queue: Record<string, unknown>[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    flushTimer = null;
    if (queue.length === 0) return;
    try {
      pageCall(bridge, "sendDevProbe", queue.splice(0, queue.length));
    } catch (error: unknown) {
      console.warn("The development probe could not send its events", error);
      queue.length = 0;
    }
  };
  const push = (type: string, data: Record<string, unknown>) => {
    queue.push({ t: Date.now(), type, ...data });
    flushTimer ??= setTimeout(flush, 1000);
  };

  const seenEndpoints = new Set<string>();
  const noteUrl = (raw: unknown, via: string) => {
    let url;
    try {
      url = String(raw);
    } catch (error: unknown) {
      console.warn("The development probe could not read a URL", error);
      return;
    }
    let pathname = url;
    try {
      pathname = new URL(url, location.href).pathname;
    } catch (error) {
      console.warn("devprobe.script: operation failed", error);
    }
    const isApi = url.includes("/youtubei/v1/");

    const key = via + "|" + pathname + (isApi ? `|${String(url.split("?")[0])}` : "");
    if (seenEndpoints.has(key)) return;
    seenEndpoints.add(key);
    push("net", { via, pathname, api: isApi, url: url.slice(0, 300) });
  };

  for (const entry of performance.getEntriesByType("resource")) noteUrl(entry.name, "preload");

  const fetchOwner: { fetch: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch> } = window;
  const originalFetch = fetchOwner.fetch;
  window.fetch = function (...args) {
    try {
      const url = pageMember(args[0], "url");
      const hasUrl = Boolean(url);
      noteUrl(hasUrl ? url : args[0], "fetch");
    } catch (error) {
      console.warn("devprobe.script: operation failed", error);
    }
    return originalFetch.apply(this, args);
  };

  const xhrPrototype: { open: (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest["open"]>) => void } = XMLHttpRequest.prototype;
  const originalOpen = xhrPrototype.open;
  XMLHttpRequest.prototype.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: [async?: boolean, username?: string | null, password?: string | null]
  ) {
    try {
      noteUrl(url, "xhr");
    } catch (error) {
      console.warn("devprobe.script: operation failed", error);
    }
    Reflect.apply(originalOpen, this, [method, url, ...rest]);
  };

  window.WebSocket = new Proxy(window.WebSocket, {
    construct(target, args: unknown[]) {
      try {
        push("ws", { url: String(args[0]).slice(0, 300) });
      } catch (error) {
        console.warn("devprobe.script: operation failed", error);
      }
      const instance: unknown = Reflect.construct(target, args);
      if (typeof instance !== "object" || instance === null) throw new Error("WebSocket construction failed");
      return instance;
    },
  });

  if (pageWindow.EventSource) {
    pageWindow.EventSource = new Proxy(pageWindow.EventSource, {
      construct(target, args: unknown[]) {
        try {
          push("sse", { url: String(args[0]).slice(0, 300) });
        } catch (error) {
          console.warn("devprobe.script: operation failed", error);
        }
        const instance: unknown = Reflect.construct(target, args);
        if (typeof instance !== "object" || instance === null) throw new Error("EventSource construction failed");
        return instance;
      },
    });
  }

  document.addEventListener("yt-action", (event) => {
    const name = pageMember(event, "detail", "actionName");
    if (name) push("action", { name });
  });
  document.addEventListener("yt-popup-opened", (event) => {
    const nodeName = pageMember(event, "detail", "nodeName");
    const hasNodeName = Boolean(nodeName);
    push("popup", { nodeName: hasNodeName ? nodeName : null });
  });

  try {
    const hook: unknown = Reflect.get(window, "__YTMD_HOOK__");
    const store = pageMember(hook, "ytmStore");
    if (store) {
      let prevCast = "";
      let prevPlayerFlags = "";
      pageCall(store, "subscribe", () => {
        const state = pageRecord(pageCall(store, "getState")) ?? {};
        const castStatus = state.castStatus;
        const hasCastStatus = Boolean(castStatus);
        const castValue = hasCastStatus ? castStatus : null;
        const cast = JSON.stringify(castValue);
        if (cast !== prevCast) {
          prevCast = cast;
          push("store", { slice: "castStatus", value: castValue });
        }
        const player = pageRecord(state.player) ?? {};
        const flags = JSON.stringify({
          playerPageOpen: pageMember(state.playerPage, "playerPageOpen"),
          trackState: player.trackState,
          adPlaying: player.adPlaying,
        });
        if (flags !== prevPlayerFlags) {
          prevPlayerFlags = flags;
          const value: unknown = JSON.parse(flags);
          push("store", { slice: "player", value });
        }
      });
    }
  } catch (error) {
    console.warn("devprobe.script: operation failed", error);
  }

  const pollHistory = async () => {
    try {
      const yt: unknown = Reflect.get(window, "yt");
      const cfg = pageRecord(pageMember(yt, "config_"));
      if (!cfg?.INNERTUBE_CONTEXT) {
        push("history", { error: "no innertube config" });
        return;
      }
      const sapisid = /(?:^|; )SAPISID=([^;]+)/.exec(document.cookie);
      if (!sapisid?.[1]) {
        push("history", { error: "no SAPISID cookie" });
        return;
      }
      const ts = Math.floor(Date.now() / 1000);
      const digest = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(`${ts} ${sapisid[1]} https://music.youtube.com`));
      const hash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const sessionIndex: unknown = cfg.SESSION_INDEX ?? 0;
      const response = await originalFetch.call(window, "/youtubei/v1/browse?prettyPrint=false", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          Authorization: `SAPISIDHASH ${ts}_${hash}`,
          "X-Origin": "https://music.youtube.com",
          "X-Goog-AuthUser": String(sessionIndex),
        },
        body: JSON.stringify({ context: cfg.INNERTUBE_CONTEXT, browseId: "FEmusic_history" }),
      });
      if (!response.ok) {
        push("history", { error: `http ${response.status}` });
        return;
      }
      await response.json().then(
        (data: unknown) => {
          const items: { videoId: unknown; columns: string[] }[] = [];
          const runsText = (runs: unknown) =>
            pageArray(runs)
              .map((r) => pageMember(r, "text"))
              .join("");
          const visit = (node: unknown): void => {
            if (!node || typeof node !== "object" || items.length >= 8) return;
            if (Array.isArray(node)) {
              for (const n of node) visit(n);
              return;
            }
            const item = pageMember(node, "musicResponsiveListItemRenderer");
            if (item) {
              const videoId = pageMember(item, "playlistItemData", "videoId");
              const hasVideoId = Boolean(videoId);
              items.push({
                videoId: hasVideoId ? videoId : null,
                columns: pageArray(pageMember(item, "flexColumns")).map((c) =>
                  runsText(pageMember(c, "musicResponsiveListItemFlexColumnRenderer", "text", "runs"))
                ),
              });
              return;
            }
            for (const value of Object.values(node)) visit(value);
          };
          visit(data);
          push("history", { head: items.slice(0, 5) });
        },
        (error: unknown) => {
          const message = pageMember(error, "errorMessage");
          const hasMessage = Boolean(message);
          const detail: unknown = hasMessage ? message : error;
          push("history", { error: String(detail) });
        }
      );
    } catch (error) {
      push("history", { error: String(error) });
    }
  };

  const poll = () => {
    pollHistory().catch((error: unknown) => console.warn("The development probe could not read history", error));
  };
  setInterval(poll, 15000);
  poll();
  push("probe-started", { href: location.href });
}
