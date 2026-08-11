// Dumps the parts of YouTube Music's own store that could describe playback on
// another device on the same account: cast/lounge/remote/queue slices. Run it
// while a phone on the same account is playing to see whether the web client
// learns about that session, and through which slice.
//
// Read-only by design: it never joins, claims or controls a session. Local
// diagnostic; meaningful results need a signed-in profile.
//
// Manual mode (YTMD_PROBE_MANUAL=1): waits for a sign-in, records yt-popup-opened
// events, then polls the account history (browseId FEmusic_history) through the
// page's own yt-service-request bus for ~10 minutes while a phone on the same
// account plays. Answers: does the history head move while a track plays
// elsewhere, how fast, and in what response shape. Needs a person at the
// keyboard and a raised watchdog:
//
//   YTMD_PROBE_MANUAL=1 node tools/test-harness/run.mjs remote-device-probe --timeout 1500
//
// YTMD_PROBE_CAST=1 additionally re-enables the cast slice the preload disables
// and re-dumps it at the end. Off by default: cast discovery announces this
// client to the account's device list, which the default probe must not do.

export const fixture = {
  playback: {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false
  }
};

const SLICE_PATTERN = "device|session|remote|lounge|mdx|cast|transfer";

const POLL_INTERVAL_MS = 20000;
const POLL_DURATION_MS = 10 * 60 * 1000;

// Page-world expression: one authenticated browse of the account history via
// the same yt-service-request bus getplaylists.script.js uses, reduced to the
// shelf titles and the first few items so a poll line stays readable. Resolves
// a JSON string; rejects if the request bus is unavailable.
const FETCH_HISTORY = `(() => new Promise((resolve, reject) => {
  const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
  if (!bar) { reject(new Error("no player bar")); return; }
  const returnValue = [];
  bar.dispatchEvent(new CustomEvent("yt-action", {
    bubbles: true,
    cancelable: false,
    composed: true,
    detail: {
      actionName: "yt-service-request",
      args: [bar, { browseEndpoint: { browseId: "FEmusic_history" } }],
      optionalAction: false,
      returnValue
    }
  }));
  if (!returnValue[0] || !returnValue[0].ajaxPromise) { reject(new Error("no ajaxPromise on returnValue")); return; }
  returnValue[0].ajaxPromise.then(
    response => {
      const data = response.data ?? {};
      const shelves = [];
      const items = [];
      const runsText = runs => (runs ?? []).map(r => r.text).join("");
      const visit = (node, shelf) => {
        if (!node || typeof node !== "object" || items.length >= 50) return;
        if (Array.isArray(node)) { for (const n of node) visit(n, shelf); return; }
        if (node.musicShelfRenderer) {
          const title = runsText(node.musicShelfRenderer.title?.runs);
          shelves.push(title);
          visit(node.musicShelfRenderer.contents, title);
          return;
        }
        if (node.musicResponsiveListItemRenderer) {
          const r = node.musicResponsiveListItemRenderer;
          items.push({
            shelf: shelf ?? null,
            videoId: r.playlistItemData?.videoId ?? null,
            columns: (r.flexColumns ?? []).map(c => runsText(c.musicResponsiveListItemFlexColumnRenderer?.text?.runs)),
            thumbnailUrl: r.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url ?? null
          });
          return;
        }
        for (const value of Object.values(node)) visit(value, shelf);
      };
      visit(data, null);
      resolve(JSON.stringify({
        topKeys: Object.keys(data),
        shelves,
        head: items.slice(0, 5),
        total: items.length,
        rawSample: items.length === 0 ? JSON.stringify(data).slice(0, 4000) : undefined
      }));
    },
    error => reject(new Error("history request failed: " + (error?.errorMessage ?? String(error))))
  );
}))()`;

const DUMP_SLICES = `(() => {
  const state = window.__YTMD_HOOK__.ytmStore.getState() ?? {};
  const pattern = new RegExp("${SLICE_PATTERN}", "i");
  const found = {};
  for (const [key, value] of Object.entries(state)) {
    if (pattern.test(key)) {
      found[key] = value;
      continue;
    }
    if (value && typeof value === "object") {
      for (const inner of Object.keys(value)) {
        if (pattern.test(inner)) {
          found[key] = found[key] ?? {};
          found[key][inner] = value[inner];
        }
      }
    }
  }
  try {
    return JSON.stringify(found);
  } catch {
    return JSON.stringify(Object.keys(found));
  }
})()`;

export default async function remoteDeviceProbe(ctx) {
  await ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", hooked => hooked === true, 90000), 95000);

  await ctx.step("store slices enumerated", async () => {
    const keys = await ctx.evalYtm(`JSON.stringify(Object.keys(window.__YTMD_HOOK__.ytmStore.getState() ?? {}))`);
    ctx.emit("probe", { topLevelKeys: JSON.parse(keys) });
  });

  await ctx.step("candidate slices dumped", async () => {
    const dump = await ctx.evalYtm(DUMP_SLICES);
    ctx.emit("probe", { candidateSlices: JSON.parse(dump) });
  });

  if (process.env.YTMD_PROBE_MANUAL !== "1") return;

  ctx.emit("probe-instructions", {
    message:
      "Manual probe: sign in inside the app window (up to 10 minutes). Once signed in, start a track on the phone and note the wall-clock time. The probe then polls the account history every 20s for 10 minutes."
  });

  await ctx.step(
    "signed in",
    () => ctx.waitYtm("!!(window.yt && window.yt.config_ && window.yt.config_.LOGGED_IN)", loggedIn => loggedIn === true, 600000),
    605000
  );

  await ctx.step("popup recorder installed", () =>
    ctx.evalYtm(`(() => {
      if (!window.__probePopups) {
        window.__probePopups = [];
        document.addEventListener("yt-popup-opened", event => {
          window.__probePopups.push({ t: Date.now(), nodeName: event.detail?.nodeName ?? null });
        });
      }
      return true;
    })()`)
  );

  await ctx.step(
    "history polled",
    async () => {
      const deadline = Date.now() + POLL_DURATION_MS;
      let lastHeadIds = "";
      let lastSlices = "";
      let lastPopupCount = 0;
      let poll = 0;
      while (Date.now() < deadline) {
        poll++;
        try {
          const history = JSON.parse(await ctx.evalYtm(FETCH_HISTORY));
          const headIds = JSON.stringify(history.head.map(item => item.videoId));
          if (headIds !== lastHeadIds || poll === 1) {
            lastHeadIds = headIds;
            ctx.emit("probe", { poll, history });
          } else {
            ctx.emit("probe", { poll, headUnchanged: true });
          }
        } catch (error) {
          ctx.emit("probe", { poll, historyError: String(error) });
        }
        try {
          const slices = await ctx.evalYtm(DUMP_SLICES);
          if (slices !== lastSlices) {
            lastSlices = slices;
            ctx.emit("probe", { poll, candidateSlices: JSON.parse(slices) });
          }
          const popups = JSON.parse(await ctx.evalYtm("JSON.stringify(window.__probePopups ?? [])"));
          if (popups.length !== lastPopupCount) {
            lastPopupCount = popups.length;
            ctx.emit("probe", { poll, popups });
          }
        } catch (error) {
          ctx.emit("probe", { poll, sliceError: String(error) });
        }
        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    },
    POLL_DURATION_MS + 60000
  );

  if (process.env.YTMD_PROBE_CAST === "1") {
    await ctx.step("cast slice re-enabled and dumped", async () => {
      await ctx.evalYtm(`window.__YTMD_HOOK__.ytmStore.dispatch({ type: "SET_CAST_AVAILABLE", payload: true })`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      const dump = await ctx.evalYtm(`JSON.stringify(window.__YTMD_HOOK__.ytmStore.getState()?.castStatus ?? null)`);
      ctx.emit("probe", { castStatusAfterReenable: JSON.parse(dump) });
    });
  }
}
