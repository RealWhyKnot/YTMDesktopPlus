import { record } from "../values.ts";
import { parseJson } from "../validation.ts";
import { responseBody } from "../companion-values.ts";
import type { HarnessContext } from "../run.ts";
export async function obtainCompanionToken(ctx: HarnessContext) {
  await ctx.companion.waitForServer(30000);

  await ctx.waitMain("window.ytmd ? (window.ytmd.memoryStore.set('companionServerAuthWindowEnabled', true), true) : false", (done) => done === true, 20000);

  const codeResponse = await ctx.companion.request("/api/v1/auth/requestcode", {
    method: "POST",
    body: { appId: "ytmdesktoptestharness", appName: "Test Harness", appVersion: "1.0.0" },
  });
  const codeBody = responseBody(codeResponse.body);
  if (codeResponse.status !== 200 || !codeBody?.code) {
    throw new Error(`requestcode failed: ${codeResponse.status} ${JSON.stringify(codeResponse.body)}`);
  }

  const tokenPromise = ctx.companion.request("/api/v1/auth/request", {
    method: "POST",
    body: { appId: "ytmdesktoptestharness", code: codeBody.code },
    timeoutMs: 45000,
  });

  await ctx.waitTarget(/authorize-companion/, 15000);

  await ctx.waitOnTarget(
    /authorize-companion/,
    "document.querySelector('button.allow') ? (document.querySelector('button.allow').click(), true) : false",
    (clicked) => clicked === true,
    15000
  );

  const tokenResponse = await tokenPromise;
  const tokenBody = responseBody(tokenResponse.body);
  if (tokenResponse.status !== 200 || !tokenBody?.token) {
    throw new Error(`auth request failed: ${tokenResponse.status} ${JSON.stringify(tokenResponse.body)}`);
  }
  return tokenBody.token;
}

export function playbackFixture(overrides = {}) {
  return {
    continueWhereYouLeftOff: false,
    continueWhereYouLeftOffPaused: false,
    enableSpeakerFill: false,
    progressInTaskbar: false,
    ratioVolume: false,
    ...overrides,
  };
}

export function roomIntegrationsFixture(overrides = {}) {
  return {
    companionServerEnabled: false,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false,
    listenAlongEnabled: false,
    listenAlongHost: null,
    listenAlongHostPort: 9863,
    listenAlongToken: null,
    ...overrides,
  };
}

export function hooksReadyStep(ctx: HarnessContext) {
  return ctx.step("hooks ready", () => ctx.waitYtm("!!window.__YTMD_HOOK__", (hooked) => hooked === true, 90000), 95000);
}

const POPUP_OPEN_CHECK = `(() => {
  for (const selector of ["tp-yt-iron-dropdown", "ytmusic-menu-popup-renderer", "tp-yt-paper-dialog", "yt-sheet-view-model"]) {
    for (const el of document.querySelectorAll(selector)) {
      if (el.getAttribute("aria-hidden") === "true") continue;
      const box = el.getBoundingClientRect();
      if (box.width > 40 && box.height > 40) return selector;
    }
  }
  return false;
})()`;

export async function openPopupMenu(ctx: HarnessContext) {
  const clickNth = (index: number) =>
    ctx
      .evalYtm(
        `JSON.stringify((() => {
    window.focus();
    const buttons = [];
    for (const menu of document.querySelectorAll("ytmusic-player-bar ytmusic-menu-renderer, ytmusic-menu-renderer")) {
      const button = menu.querySelector("tp-yt-paper-icon-button, yt-icon-button button, yt-icon-button, button");
      if (!button) continue;
      const box = button.getBoundingClientRect();
      buttons.push({ button, visible: box.width > 0 && box.height > 0 });
    }
    buttons.sort((a, b) => Number(b.visible) - Number(a.visible));
    const pick = buttons[${index}];
    if (!pick) return { clicked: null, total: buttons.length };
    pick.button.focus();
    pick.button.click();
    return { clicked: "menu button " + ${index}, visible: pick.visible, total: buttons.length, hasFocus: document.hasFocus() };
  })())`
      )
      .then((result) => parseJson(result));

  const pump = () =>
    ctx.screenshotYtm().then(
      () => undefined,
      () => undefined
    );
  const waitOpen = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await pump();
      const open = parseJson(await ctx.evalYtm(`JSON.stringify(${POPUP_OPEN_CHECK})`));
      if (open) return open;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    return null;
  };

  const attempts = [];
  let lastTrigger = null;
  for (let index = 0; index < 6; index++) {
    const attempt = await clickNth(index);
    attempts.push(attempt);
    if (!record(attempt).clicked) break;
    lastTrigger = record(attempt).clicked;
    const container = await waitOpen();
    if (container) return { opened: true, trigger: record(attempt).clicked, container };
  }

  const card = parseJson(
    await ctx.evalYtm(`JSON.stringify((() => {
      const card = document.querySelector("ytmusic-two-row-item-renderer, ytmusic-responsive-list-item-renderer");
      if (!card) return { clicked: null };
      const box = card.getBoundingClientRect();
      card.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
      return { clicked: "contextmenu on card" };
    })())`)
  );
  if (record(card).clicked) {
    const container = await waitOpen();
    if (container) return { opened: true, trigger: record(card).clicked, container };
  }
  if (!record(card).clicked && !lastTrigger) return { opened: false, reason: "no menu trigger in the dom", attempts };
  const clicked = record(card).clicked;
  const wasClicked = Boolean(clicked);
  return { opened: false, reason: "menu never opened", trigger: wasClicked ? clicked : lastTrigger, attempts };
}

export function closePopupMenu(ctx: HarnessContext) {
  return ctx
    .evalYtm(
      `JSON.stringify((() => {
      const dropdown = document.querySelector('tp-yt-iron-dropdown:not([aria-hidden="true"])');
      if (dropdown && typeof dropdown.close === "function") dropdown.close();
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      void document.body.offsetHeight;
      return { stillOpen: !!document.querySelector('tp-yt-iron-dropdown:not([aria-hidden="true"])') };
    })())`
    )
    .then((result) => parseJson(result));
}
