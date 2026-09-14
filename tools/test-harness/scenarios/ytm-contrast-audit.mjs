import fs from "fs";
import { closePopupMenu, hooksReadyStep, obtainCompanionToken, openPopupMenu, playbackFixture } from "./lib.mjs";

export const needsCompanion = true;
export const fixture = {
  playback: playbackFixture({ adBlockerEnabled: false, preventIdlePause: true }),
  themes: { active: process.env.YTMD_PROBE_THEME || null },
  integrations: {
    companionServerEnabled: true,
    companionServerAuthTokens: null,
    companionServerCORSWildcardEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false
  }
};

const VIDEO_ID = "dQw4w9WgXcQ";

const INSTALL = `(() => {
  const parse = value => {
    if (!value) return null;
    const v = value.trim();
    if (v[0] === "#") {
      const digits = v.slice(1);
      const full = digits.length === 3 ? digits.replace(/./g, d => d + d) : digits;
      if (full.length !== 6 && full.length !== 8) return null;
      const n = part => parseInt(full.slice(part * 2, part * 2 + 2), 16);
      return [n(0), n(1), n(2), full.length === 8 ? n(3) / 255 : 1];
    }
    if (v.indexOf("rgb") === 0) {
      const parts = v.slice(v.indexOf("(") + 1, v.lastIndexOf(")")).split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat);
      if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
      return [parts[0], parts[1], parts[2], parts.length > 3 && !Number.isNaN(parts[3]) ? parts[3] : 1];
    }
    if (v.indexOf("color(srgb") === 0) {
      const parts = v.slice(11, v.lastIndexOf(")")).replace("/", " ").split(/\\s+/).filter(Boolean).map(parseFloat);
      if (parts.length < 3 || parts.some(Number.isNaN)) return null;
      return [parts[0] * 255, parts[1] * 255, parts[2] * 255, parts.length > 3 ? parts[3] : 1];
    }
    return null;
  };
  const over = (top, under) => {
    const alpha = top[3] + under[3] * (1 - top[3]);
    if (alpha <= 0) return [0, 0, 0, 0];
    const mix = i => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / alpha;
    return [mix(0), mix(1), mix(2), alpha];
  };
  const luminance = rgb => {
    const linear = channel => {
      const r = channel / 255;
      return r <= 0.04045 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
  };
  const ratio = (a, b) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const fmt = c => "rgb(" + Math.round(c[0]) + ", " + Math.round(c[1]) + ", " + Math.round(c[2]) + ")";

  const backdrop = (x, y, parent) => {
    const stack = document.elementsFromPoint(x, y);
    let start = stack.findIndex(el => el === parent || el.contains(parent));
    let approx = false;
    if (start < 0) {
      start = 0;
      approx = true;
    }
    let acc = [0, 0, 0, 0];
    for (let i = start; i < stack.length; i++) {
      const cs = getComputedStyle(stack[i]);
      if (cs.backgroundImage !== "none") approx = true;
      const bg = parse(cs.backgroundColor);
      if (bg && bg[3] > 0) {
        acc = over(acc, bg);
        if (acc[3] >= 0.999) return { color: acc, approx };
      }
    }
    const body = parse(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
    return { color: over(acc, [body[0], body[1], body[2], 1]), approx };
  };

  const api = {};
  api._fails = new Map();

  api.audit = rootSelector => {
    const roots = rootSelector ? [...document.querySelectorAll(rootSelector)] : [document.body];
    const root = roots.find(el => {
      if (el.getAttribute("aria-hidden") === "true") return false;
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    }) || roots[0];
    if (!root) return { found: false, rootSelector };
    const rootBox = root.getBoundingClientRect();
    const rootRect = [Math.round(rootBox.x), Math.round(rootBox.y), Math.round(rootBox.width), Math.round(rootBox.height)];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const seen = new Map();
    const skipped = { zeroRect: 0, offViewport: 0, hiddenCss: 0, transparentFg: 0 };
    let textNodes = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent || !node.textContent.trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TITLE") continue;
      textNodes += 1;
      if (textNodes > 5000 || seen.size >= 250) break;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) {
        skipped.zeroRect += 1;
        continue;
      }
      const cx = rect.x + Math.min(rect.width, 40) / 2;
      const cy = rect.y + rect.height / 2;
      if (cx < 0 || cy < 0 || cx >= innerWidth || cy >= innerHeight) {
        skipped.offViewport += 1;
        continue;
      }
      if (parent.checkVisibility && !parent.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) {
        skipped.hiddenCss += 1;
        continue;
      }
      const cs = getComputedStyle(parent);
      const fgRaw = parse(cs.color);
      if (!fgRaw || fgRaw[3] < 0.05) {
        skipped.transparentFg += 1;
        continue;
      }
      const classes = typeof parent.className === "string" ? parent.className.split(/\\s+/).filter(c => /^[A-Za-z0-9_-]+$/.test(c)).sort() : [];
      const sig = tag.toLowerCase() + (classes.length ? "." + classes.join(".") : "");
      const size = parseFloat(cs.fontSize) || 0;
      const weight = parseFloat(cs.fontWeight) || 400;
      const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      const back = backdrop(cx, cy, parent);
      const fg = fgRaw[3] < 1 ? over(fgRaw, back.color) : fgRaw;
      const value = Math.round(ratio(fg, back.color) * 100) / 100;
      const prior = seen.get(sig);
      if (prior && prior.ratio <= value) continue;
      let source = parent;
      let up = parent.parentElement;
      while (up && up.nodeType === 1 && getComputedStyle(up).color === cs.color) {
        source = up;
        up = up.parentElement;
      }
      const describe = el => {
        const cls = typeof el.className === "string" ? el.className.split(/\\s+/).filter(c => /^[A-Za-z0-9_-]+$/.test(c)).slice(0, 4) : [];
        return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls.length ? "." + cls.join(".") : "");
      };
      api._fails.set(sig, parent);
      seen.set(sig, {
        colorSource: source === parent ? null : describe(source),
        sig,
        selector: tag.toLowerCase() + (classes.length ? "." + classes.slice(0, 3).join(".") : ""),
        sampleText: node.textContent.trim().slice(0, 40),
        fg: fmt(fg),
        bg: fmt(back.color),
        ratio: value,
        need,
        fontSize: Math.round(size * 10) / 10,
        weight,
        approx: back.approx
      });
    }
    const entries = [...seen.values()];
    const failures = entries
      .filter(entry => entry.ratio < entry.need)
      .sort((a, b) => a.ratio - b.ratio)
      .slice(0, 40);
    return { found: true, rootSelector: rootSelector || "body", rootRect, viewport: [innerWidth, innerHeight], textNodes, skipped, signatures: entries.length, failures };
  };

  api.varTrails = (sig, names) => {
    const element = api._fails.get(sig) || document.querySelector(sig);
    if (!element) return { sig, found: false };
    const trails = {};
    for (const name of names) {
      const chain = [];
      let current = element;
      while (current && current.nodeType === 1) {
        const value = getComputedStyle(current).getPropertyValue(name).trim();
        if (!chain.length || chain[chain.length - 1].value !== value) {
          const classes = typeof current.className === "string" ? current.className.split(/\\s+/).filter(c => /^[A-Za-z0-9_-]+$/.test(c)).slice(0, 3) : [];
          chain.push({
            at: current.tagName.toLowerCase() + (current.id ? "#" + current.id : "") + (classes.length ? "." + classes.join(".") : ""),
            value: value.slice(0, 80)
          });
        }
        current = current.parentElement;
      }
      trails[name] = chain;
    }
    return { sig, found: true, trails };
  };

  api.ambient = zOverride => {
    const app = document.querySelector("ytmusic-app");
    if (!app) return { found: false };
    const after = getComputedStyle(app, "::after");
    const id = "ytmd-contrast-probe";
    let style = document.getElementById(id);
    if (!style) {
      style = document.createElement("style");
      style.id = id;
      document.head.appendChild(style);
    }
    const zRule = zOverride === null || zOverride === undefined ? "" : "z-index: " + zOverride + " !important;";
    style.textContent = "ytmusic-app::after { pointer-events: auto !important;" + zRule + " }";
    void document.body.offsetHeight;
    const points = [
      [Math.round(innerWidth / 2), Math.round(innerHeight * 0.25)],
      [Math.round(innerWidth / 2), Math.round(innerHeight * 0.6)]
    ];
    const hits = points.map(([x, y]) => {
      const top = document.elementFromPoint(x, y);
      return { point: [x, y], topTag: top ? top.tagName.toLowerCase() : null, overlayOnTop: top === app };
    });
    style.textContent = "";
    void document.body.offsetHeight;
    const popup = document.querySelector("ytmusic-popup-container");
    const page = document.querySelector("ytmusic-player-page");
    const pageStyle = page ? getComputedStyle(page) : null;
    const appStyle = getComputedStyle(app);
    return {
      found: true,
      appStacking: { zIndex: appStyle.zIndex, position: appStyle.position, transform: appStyle.transform !== "none", contain: appStyle.contain, isolation: appStyle.isolation },
      pageStacking: pageStyle ? { zIndex: pageStyle.zIndex, position: pageStyle.position, transform: pageStyle.transform !== "none", contain: pageStyle.contain, isolation: pageStyle.isolation } : null,
      pseudoContent: after.content,
      animation: after.animationName === "none" ? null : {
        name: after.animationName,
        duration: after.animationDuration,
        iterationCount: after.animationIterationCount,
        fillMode: after.animationFillMode
      },
      opacity: after.opacity,
      zIndex: after.zIndex,
      zOverride: zOverride === null || zOverride === undefined ? null : zOverride,
      popupContainerZ: popup ? getComputedStyle(popup).zIndex : null,
      hits
    };
  };

  window.__contrastAudit = api;
  return true;
})()`;

async function auditSurface(ctx, surface, rootSelector) {
  const result = JSON.parse(await ctx.evalYtm(`JSON.stringify(window.__contrastAudit.audit(${JSON.stringify(rootSelector ?? null)}))`));
  ctx.emit("probe-contrast", { surface, theme: process.env.YTMD_PROBE_THEME || null, ...result });
  if (!rootSelector) {
    const chips = JSON.parse(
      await ctx.evalYtm(`JSON.stringify([...document.querySelectorAll("ytmusic-chip-cloud-chip-renderer")].slice(0, 24).map(chip => {
        const anchor = chip.querySelector("a");
        const cs = anchor ? getComputedStyle(anchor) : null;
        const box = chip.getBoundingClientRect();
        return {
          attributes: [...chip.attributes].map(a => a.name + "=" + a.value.slice(0, 50)),
          text: (chip.textContent || "").trim().slice(0, 16),
          visible: box.width > 0 && box.height > 0,
          color: cs ? cs.color : null,
          background: cs ? cs.backgroundColor : null
        };
      }))`)
    );
    ctx.emit("probe-chips", { surface, chips });
  }
  const selectors = [...new Set((result.failures || []).flatMap(failure => [failure.selector, ...(failure.colorSource ? [failure.colorSource] : [])]))].slice(
    0,
    16
  );
  if (selectors.length) {
    const matched = await ctx.matchedStylesYtm(selectors);
    ctx.emit("probe-contrast-rules", { surface, matched });
    for (const failure of (result.failures || []).slice(0, 8)) {
      const info = matched[failure.selector];
      const names = new Set(["--ytmusic-text-primary"]);
      for (const rule of info?.rules || []) {
        for (const declaration of rule.declarations || []) {
          if (!/^(color|background|fill)/.test(declaration.name)) continue;
          for (const match of String(declaration.value).matchAll(/var\((--[a-z0-9-]+)/gi)) names.add(match[1]);
        }
      }
      for (const entry of info?.inherited || []) {
        for (const match of String(entry.value || "").matchAll(/var\((--[a-z0-9-]+)/gi)) names.add(match[1]);
      }
      const trails = JSON.parse(
        await ctx.evalYtm(`JSON.stringify(window.__contrastAudit.varTrails(${JSON.stringify(failure.sig)}, ${JSON.stringify([...names].slice(0, 6))}))`)
      );
      ctx.emit("probe-var-trails", { surface, ...trails });
    }
  }
  return result;
}

async function ambientProbe(ctx, view, zOverride = null) {
  const result = JSON.parse(await ctx.evalYtm(`JSON.stringify(window.__contrastAudit.ambient(${JSON.stringify(zOverride)}))`));
  ctx.emit("probe-ambient", { view, ...result });
  if (zOverride === null && result.found && result.pseudoContent !== "none" && (result.hits || []).some(hit => !hit.overlayOnTop)) {
    for (const z of [100, 10000, 100000, 2147483647]) {
      await ambientProbe(ctx, view, z);
    }
  }
  return result;
}

export default async function ytmContrastAudit(ctx) {
  let token;
  await ctx.step(
    "obtain token",
    async () => {
      token = await obtainCompanionToken(ctx);
    },
    90000
  );

  await hooksReadyStep(ctx);

  await ctx.step(
    "browse content rendered",
    () => ctx.waitYtm("!!document.querySelector('ytmusic-carousel-shelf-renderer, ytmusic-two-row-item-renderer')", ready => ready === true, 120000),
    125000
  );

  await ctx.step(
    "theme injection settled",
    async () => {
      const appeared = await ctx
        .waitYtm("!!document.getElementById('ytmd-theme')", found => found === true, 45000)
        .then(
          () => true,
          () => false
        );
      ctx.emit("probe-injection-timing", { themeStyleAppeared: appeared });
    },
    50000
  );

  await ctx.step("auditor installed", () => ctx.evalYtm(INSTALL), 60000);

  await ctx.step("browse home audited", () => auditSurface(ctx, "browse-home", null), 90000);
  await ctx.step("ambient measured on browse", () => ambientProbe(ctx, "browse"), 30000);

  await ctx.step(
    "popup menu audited",
    async () => {
      const popup = await openPopupMenu(ctx);
      if (!popup.opened) {
        ctx.emit("probe-contrast", { surface: "popup-menu", theme: process.env.YTMD_PROBE_THEME || null, found: false, reason: popup.reason });
        return;
      }
      await auditSurface(ctx, "popup-menu", popup.container);
      ctx.emit("probe-popup-closed", await closePopupMenu(ctx));
    },
    90000
  );

  await ctx.step(
    "search suggestions audited",
    async () => {
      const typed = JSON.parse(
        await ctx.evalYtm(`JSON.stringify((() => {
          const input = document.querySelector("ytmusic-search-box input");
          if (!input) return { typed: false };
          input.focus();
          input.value = "love";
          input.dispatchEvent(new InputEvent("input", { bubbles: true, data: "love" }));
          return { typed: true };
        })())`)
      );
      if (!typed.typed) {
        ctx.emit("probe-contrast", { surface: "search-suggestions", theme: process.env.YTMD_PROBE_THEME || null, found: false, reason: "no search input" });
        return;
      }
      const visible = await ctx
        .waitYtm(
          `(() => {
            const section = document.querySelector("ytmusic-search-suggestions-section");
            if (!section) return false;
            const box = section.getBoundingClientRect();
            return box.width > 0 && box.height > 0;
          })()`,
          ready => ready === true,
          15000
        )
        .then(
          () => true,
          () => false
        );
      if (!visible) {
        ctx.emit("probe-contrast", {
          surface: "search-suggestions",
          theme: process.env.YTMD_PROBE_THEME || null,
          found: false,
          reason: "suggestions never appeared"
        });
        return;
      }
      await auditSurface(ctx, "search-suggestions", "ytmusic-search-suggestions-section");
      await ctx.evalYtm(`(() => {
        const input = document.querySelector("ytmusic-search-box input");
        if (input) {
          input.value = "";
          input.dispatchEvent(new InputEvent("input", { bubbles: true }));
          input.blur();
        }
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        return true;
      })()`);
    },
    60000
  );

  await ctx.step(
    "playback started",
    async () => {
      const res = await ctx.companion.request("/api/v1/command", { method: "POST", token, body: { command: "changeVideo", data: { videoId: VIDEO_ID } } });
      if (res.status !== 204) throw new Error(`changeVideo returned ${res.status}`);
      const deadline = Date.now() + 90000;
      let last = null;
      while (Date.now() < deadline) {
        const state = await ctx.companion.request("/api/v1/state", { token });
        last = state.body;
        const progressing = last?.player?.trackState === 1 || last?.player?.adPlaying === true || (last?.player?.videoProgress ?? 0) > 0;
        if (progressing) return;
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
      throw new Error(`video never progressed: ${JSON.stringify(last?.player)}`);
    },
    120000
  );

  await ctx.step(
    "player page opened",
    async () => {
      const opened = JSON.parse(
        await ctx.evalYtm(`JSON.stringify((() => {
          const layout = document.querySelector("ytmusic-app-layout");
          if (layout && layout.hasAttribute("player-page-open")) return { clicked: null, already: true };
          for (const selector of ["ytmusic-player-bar .toggle-player-page-button", "ytmusic-player-bar .content-info-wrapper"]) {
            const target = document.querySelector(selector);
            if (!target) continue;
            target.click();
            return { clicked: selector, already: false };
          }
          return { clicked: null, already: false };
        })())`)
      );
      ctx.emit("probe-player-page", opened);
      if (!opened.already && !opened.clicked) throw new Error("no player page toggle found");
      let placed = false;
      for (let attempt = 0; attempt < 12 && !placed; attempt++) {
        await ctx.screenshotYtm().then(
          () => undefined,
          () => undefined
        );
        const state = JSON.parse(
          await ctx.evalYtm(`JSON.stringify((() => {
            const page = document.querySelector("ytmusic-player-page");
            const box = page ? page.getBoundingClientRect() : null;
            return { y: box ? Math.round(box.y) : null, visibility: document.visibilityState };
          })())`)
        );
        ctx.emit("probe-player-page-state", { attempt, ...state });
        placed = state.y !== null && state.y <= 100;
        if (!placed) await new Promise(resolve => setTimeout(resolve, 800));
      }
      const layout = JSON.parse(
        await ctx.evalYtm(`JSON.stringify((() => {
          const rect = selector => {
            const el = document.querySelector(selector);
            if (!el) return null;
            const box = el.getBoundingClientRect();
            return [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)];
          };
          const appLayout = document.querySelector("ytmusic-app-layout");
          return {
            viewport: [innerWidth, innerHeight],
            scroll: [scrollX, scrollY],
            layoutAttributes: appLayout ? [...appLayout.attributes].map(a => a.name) : null,
            playerPage: rect("ytmusic-player-page"),
            playerBar: rect("ytmusic-player-bar"),
            queue: rect("ytmusic-player-queue"),
            controls: rect("ytmusic-player-controls"),
            mainPanel: rect("ytmusic-player-page #main-panel"),
            sidePanel: rect("ytmusic-player-page #side-panel")
          };
        })())`)
      );
      ctx.emit("probe-layout", layout);
    },
    45000
  );

  await ctx.step(
    "queue tab selected",
    async () => {
      const tab = JSON.parse(
        await ctx.evalYtm(`JSON.stringify((() => {
          const tabs = [...document.querySelectorAll("ytmusic-player-page tp-yt-paper-tab, tp-yt-paper-tab")];
          if (!tabs.length) return { clicked: null, tabs: 0 };
          const queueTab = tabs.find(entry => /next|queue/i.test(entry.textContent || "")) || tabs[0];
          queueTab.click();
          return { clicked: (queueTab.textContent || "").trim().slice(0, 30), tabs: tabs.length };
        })())`)
      );
      ctx.emit("probe-queue-tab", tab);
      await ctx.screenshotYtm().then(
        () => undefined,
        () => undefined
      );
      await new Promise(resolve => setTimeout(resolve, 1200));
    },
    30000
  );

  await ctx.step("player view audited", () => auditSurface(ctx, "player-view", null), 90000);
  await ctx.step("ambient measured on player page", () => ambientProbe(ctx, "player-page"), 30000);

  if (process.env.YTMD_PROBE_SHOT) {
    await ctx.step(
      "screenshot captured",
      async () => {
        const png = await ctx.screenshotYtm();
        fs.writeFileSync(process.env.YTMD_PROBE_SHOT, png);
        ctx.emit("probe-screenshot", { path: process.env.YTMD_PROBE_SHOT, bytes: png.length });
      },
      60000
    );
  }
}
