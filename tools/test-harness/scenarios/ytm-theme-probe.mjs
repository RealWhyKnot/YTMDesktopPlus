import fs from "fs";
import { hooksReadyStep, playbackFixture } from "./lib.mjs";

export const fixture = {
  playback: playbackFixture(),
  themes: { active: process.env.YTMD_PROBE_THEME || null },
  integrations: {
    companionServerEnabled: false,
    discordPresenceEnabled: false,
    lastFMEnabled: false
  }
};

const SAMPLES = {
  html: "html",
  body: "body",
  app: "ytmusic-app",
  layout: "ytmusic-app-layout",
  content: "#content",
  browse: "ytmusic-browse-response",
  sectionList: "ytmusic-section-list-renderer",
  shelf: "ytmusic-carousel-shelf-renderer",
  shelfTitle: "ytmusic-carousel-shelf-basic-header-renderer .title",
  shelfStrapline: "ytmusic-carousel-shelf-basic-header-renderer .strapline",
  card: "ytmusic-two-row-item-renderer",
  cardTitle: "ytmusic-two-row-item-renderer .title",
  cardSubtitle: "ytmusic-two-row-item-renderer .subtitle",
  listItem: "ytmusic-responsive-list-item-renderer",
  formattedString: "ytmusic-browse-response yt-formatted-string",
  chip: "ytmusic-chip-cloud-chip-renderer",
  navBar: "ytmusic-nav-bar",
  navBarBackground: "#nav-bar-background",
  searchBox: "ytmusic-search-box",
  searchInput: "ytmusic-search-box input",
  guide: "ytmusic-guide-renderer",
  guideEntry: "ytmusic-guide-entry-renderer",
  guideIcon: "ytmusic-guide-entry-renderer yt-icon",
  drawer: "tp-yt-app-drawer",
  playerBar: "ytmusic-player-bar",
  playerBarTitle: "ytmusic-player-bar .title",
  playerBarSubtitle: "ytmusic-player-bar .subtitle",
  playerBarIcon: "ytmusic-player-bar yt-icon",
  progress: "ytmusic-player-bar #primaryProgress",
  likeButton: "ytmusic-like-button-renderer",
  buttonShape: "ytmusic-player-bar yt-button-shape button",
  buttonShapeIcon: "ytmusic-player-bar yt-button-shape yt-icon",
  playerPage: "ytmusic-player-page",
  playerPageMain: "ytmusic-player-page #main-panel",
  browseIcon: "ytmusic-browse-response yt-icon",
  browseIconPath: "ytmusic-browse-response yt-icon svg path",
  iconButton: "tp-yt-paper-icon-button",
  menuPopup: "ytmusic-menu-popup-renderer",
  dropdown: "tp-yt-iron-dropdown"
};

const PAINT_PROPS = [
  "color",
  "background-color",
  "background-image",
  "fill",
  "stroke",
  "border-top-color",
  "border-bottom-color",
  "outline-color",
  "caret-color"
];

const SELECTOR_FORMS = [
  [":root", false],
  [":root", true],
  ["html", true],
  ["ytmusic-app", true],
  ["*", true]
];

const INSTALL = `(() => {
  const SAMPLES = ${JSON.stringify(SAMPLES)};
  const PAINT = ${JSON.stringify(PAINT_PROPS)};
  const BLANK = ["rgba(0, 0, 0, 0)", "transparent", "none", ""];
  const api = {};

  api.pick = selector => {
    try { return document.querySelector(selector); } catch { return null; }
  };

  api.elements = () => Object.entries(SAMPLES).map(([key, selector]) => [key, selector, api.pick(selector)]);

  api.tokensOn = element => {
    if (!element) return {};
    const style = getComputedStyle(element);
    const found = {};
    for (let i = 0; i < style.length; i++) {
      const name = style.item(i);
      if (name.indexOf("--") === 0) found[name] = style.getPropertyValue(name).trim();
    }
    return found;
  };

  api.sample = () => {
    const out = {};
    for (const [key, selector, element] of api.elements()) {
      if (!element) { out[key] = { selector, found: false }; continue; }
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      const paint = {};
      for (const property of PAINT) {
        const value = style.getPropertyValue(property).trim();
        if (BLANK.indexOf(value) >= 0) continue;
        paint[property] = value.slice(0, 90);
      }
      out[key] = {
        selector,
        found: true,
        tag: element.tagName.toLowerCase(),
        rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
        visible: box.width > 0 && box.height > 0,
        shadow: Boolean(element.shadowRoot),
        fillAttribute: element.getAttribute ? element.getAttribute("fill") : null,
        paint
      };
    }
    return out;
  };

  api.probeSheet = css => {
    let element = document.getElementById("ytmd-probe");
    if (!element) {
      element = document.createElement("style");
      element.id = "ytmd-probe";
      document.head.appendChild(element);
    }
    element.textContent = css;
  };

  api.candidates = () => {
    const element = api.pick(SAMPLES.browse) || api.pick(SAMPLES.app) || document.documentElement;
    return Object.entries(api.tokensOn(element))
      .filter(entry => {
        const name = entry[0];
        const value = entry[1];
        if (name.indexOf("--ytmd-") === 0 || name.indexOf("--yt") !== 0) return false;
        return value.indexOf("#") === 0 || value.indexOf("rgb") === 0 || value.indexOf("hsl") === 0;
      })
      .map(entry => entry[0])
      .sort();
  };

  api.sentinel = value => {
    if (value.indexOf("rgb") !== 0) return null;
    const inner = value.slice(value.indexOf("(") + 1);
    const parts = inner.split(",").map(part => part.trim());
    if (parts.length < 3) return null;
    if (parts[1] !== "7") return null;
    if (parts[2].split(")")[0].trim() !== "3") return null;
    const index = Number(parts[0]);
    return Number.isFinite(index) ? index : null;
  };

  api.sweep = (selector, important) => {
    const names = api.candidates();
    const hits = {};
    const bang = important ? " !important" : "";
    for (let offset = 0; offset < names.length; offset += 254) {
      const chunk = names.slice(offset, offset + 254);
      const body = chunk.map((name, i) => name + ":rgb(" + (i + 1) + ", 7, 3)" + bang).join(";");
      api.probeSheet(selector + "{" + body + "}");
      void document.body.offsetHeight;
      for (const [key, , element] of api.elements()) {
        if (!element) continue;
        const style = getComputedStyle(element);
        for (const property of PAINT) {
          const index = api.sentinel(style.getPropertyValue(property).trim());
          if (index === null) continue;
          const token = chunk[index - 1];
          if (!token) continue;
          if (!hits[token]) hits[token] = [];
          hits[token].push(key + "." + property);
        }
      }
    }
    api.probeSheet("");
    void document.body.offsetHeight;
    return { selector, important, candidates: names.length, painted: Object.keys(hits).length, hits };
  };

  api.diff = (before, after) => {
    const changed = [];
    for (const [key, was] of Object.entries(before)) {
      if (!was.found || !after[key] || !after[key].found) continue;
      const keys = new Set([...Object.keys(was.paint), ...Object.keys(after[key].paint)]);
      for (const property of keys) {
        const a = was.paint[property] || "(none)";
        const b = after[key].paint[property] || "(none)";
        if (a !== b) changed.push(key + "." + property + ": " + a + " -> " + b);
      }
    }
    return changed;
  };

  window.__probeTheme = api;
  return true;
})()`;

export default async function ytmThemeProbe(ctx) {
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

  await ctx.step("probe installed", () => ctx.evalYtm(INSTALL), 60000);

  await ctx.step("theme layer identified", async () => {
    const info = await ctx.evalYtm(`JSON.stringify((() => {
      const element = document.getElementById("ytmd-theme");
      const app = document.querySelector("ytmusic-app");
      return {
        present: Boolean(element),
        bytes: element ? element.textContent.length : 0,
        paintsYtmSelectors: element ? element.textContent.indexOf("ytmusic-") >= 0 : false,
        head: element ? element.textContent.slice(0, 400) : null,
        styleElementCount: document.querySelectorAll("style").length,
        blockedSheets: [...document.styleSheets].filter(sheet => {
          try { void sheet.cssRules; return false; } catch { return true; }
        }).length,
        totalSheets: document.styleSheets.length,
        htmlAttributes: [...document.documentElement.attributes].map(a => a.name + "=" + a.value.slice(0, 60)),
        appAttributes: app ? [...app.attributes].map(a => a.name + "=" + a.value.slice(0, 60)) : null,
        colorScheme: getComputedStyle(document.documentElement).colorScheme
      };
    })())`);
    ctx.emit("probe-theme-layer", { activeTheme: process.env.YTMD_PROBE_THEME || null, ...JSON.parse(info) });
  });

  await ctx.step("stock baseline captured", async () => {
    const result = await ctx.evalYtm(`JSON.stringify((() => {
      const api = window.__probeTheme;
      const element = document.getElementById("ytmd-theme");
      const injected = api.sample();
      if (!element) return { injected, stock: null, driftFromStock: [] };
      element.disabled = true;
      void document.body.offsetHeight;
      const stock = api.sample();
      element.disabled = false;
      void document.body.offsetHeight;
      return { injected, stock, driftFromStock: api.diff(stock, injected) };
    })())`);
    const parsed = JSON.parse(result);
    ctx.emit("probe-drift", { driftFromStock: parsed.driftFromStock });
    ctx.emit("probe-stock", parsed.stock);
    ctx.emit("probe-injected", parsed.injected);
  });

  await ctx.step("token vocabulary enumerated", async () => {
    const result = await ctx.evalYtm(`JSON.stringify((() => {
      const api = window.__probeTheme;
      const root = api.tokensOn(document.documentElement);
      const browse = api.tokensOn(api.pick("ytmusic-browse-response") || document.documentElement);
      const names = Object.keys(browse);
      return {
        countOnRoot: Object.keys(root).length,
        countOnBrowse: names.length,
        candidates: api.candidates(),
        nonYtNames: names.filter(name => name.indexOf("--yt") !== 0).slice(0, 60),
        browseTokens: Object.fromEntries(api.candidates().map(name => [name, browse[name]]))
      };
    })())`);
    ctx.emit("probe-vocabulary", JSON.parse(result));
  });

  await ctx.step(
    "selector forms swept",
    async () => {
      for (const [selector, important] of SELECTOR_FORMS) {
        const result = await ctx.evalYtm(`JSON.stringify(window.__probeTheme.sweep(${JSON.stringify(selector)}, ${important}))`);
        const parsed = JSON.parse(result);
        ctx.emit("probe-sweep", { selector: parsed.selector, important: parsed.important, candidates: parsed.candidates, painted: parsed.painted });
        ctx.emit("probe-sweep-hits", { selector: parsed.selector, important: parsed.important, hits: parsed.hits });
      }
    },
    300000
  );

  await ctx.step("dark attribute flipped", async () => {
    const result = await ctx.evalYtm(`JSON.stringify((() => {
      const api = window.__probeTheme;
      const html = document.documentElement;
      const had = html.getAttribute("dark");
      const before = api.sample();
      html.removeAttribute("dark");
      void document.body.offsetHeight;
      const after = api.sample();
      if (had !== null) html.setAttribute("dark", had);
      void document.body.offsetHeight;
      return { hadDarkAttribute: had, changed: api.diff(before, after) };
    })())`);
    ctx.emit("probe-dark-attribute", JSON.parse(result));
  });

  await ctx.step(
    "matched rules read for stubborn surfaces",
    async () => {
      const matched = await ctx.matchedStylesYtm([
        "ytmusic-two-row-item-renderer .title",
        "ytmusic-two-row-item-renderer .subtitle",
        "ytmusic-carousel-shelf-basic-header-renderer .title",
        "ytmusic-browse-response yt-formatted-string",
        "ytmusic-guide-entry-renderer .title",
        "ytmusic-guide-entry-renderer yt-icon",
        "ytmusic-browse-response yt-icon",
        "ytmusic-player-bar .title",
        "ytmusic-like-button-renderer yt-icon",
        "ytmusic-like-button-renderer",
        "ytmusic-player-bar tp-yt-paper-icon-button",
        "ytmusic-player-bar yt-button-shape button",
        "ytmusic-player-bar .middle-controls yt-icon",
        "ytmusic-player-bar .right-controls yt-icon",
        "ytmusic-player-bar #volume-slider",
        "ytmusic-player-bar .icon"
      ]);
      ctx.emit("probe-matched-rules", matched);
    },
    90000
  );

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

  await ctx.step("gradient sources listed", async () => {
    const result = await ctx.evalYtm(`JSON.stringify((() => {
      const found = [];
      for (const el of document.querySelectorAll("*")) {
        const cs = getComputedStyle(el);
        const image = cs.backgroundImage;
        const hasImage = image && image !== "none";
        const painted = cs.backgroundColor && cs.backgroundColor !== "rgba(0, 0, 0, 0)";
        if (!hasImage && !painted) continue;
        const box = el.getBoundingClientRect();
        if (box.width * box.height < 150000) continue;
        found.push({
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 70) || null,
          rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
          bg: cs.backgroundColor,
          image: image.slice(0, 200),
          opacity: cs.opacity
        });
        if (found.length >= 30) break;
      }
      return found;
    })())`);
    ctx.emit("probe-gradients", { sources: JSON.parse(result) });
  });

  await ctx.step("backdrop hit-tested", async () => {
    const result = await ctx.evalYtm(`JSON.stringify((() => {
      const points = [[640, 100], [200, 300], [1100, 150], [640, 520]];
      const describe = el => {
        const cs = getComputedStyle(el);
        const before = getComputedStyle(el, "::before");
        const after = getComputedStyle(el, "::after");
        const box = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          cls: (typeof el.className === "string" ? el.className : "").slice(0, 60) || null,
          rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)],
          bg: cs.backgroundColor,
          img: cs.backgroundImage.slice(0, 120),
          opacity: cs.opacity,
          beforeBg: before.backgroundColor,
          beforeImg: before.backgroundImage.slice(0, 120),
          beforeContent: before.content,
          afterBg: after.backgroundColor,
          afterImg: after.backgroundImage.slice(0, 120),
          afterContent: after.content
        };
      };
      return points.map(([x, y]) => ({
        point: [x, y],
        stack: document.elementsFromPoint(x, y).slice(0, 8).map(describe)
      }));
    })())`);
    ctx.emit("probe-backdrop", JSON.parse(result));
  });

  await ctx.step("shelf headings measured", async () => {
    const result =
      await ctx.evalYtm(`JSON.stringify([...document.querySelectorAll("ytmusic-carousel-shelf-basic-header-renderer .title, ytmusic-carousel-shelf-basic-header-renderer .strapline, ytmusic-shelf-renderer .title")].slice(0, 8).map(el => {
      const cs = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return {
        text: (el.textContent || "").trim().slice(0, 30),
        tag: el.tagName.toLowerCase(),
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 60),
        color: cs.color,
        opacity: cs.opacity,
        rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]
      };
    }))`);
    ctx.emit("probe-headings", { headings: JSON.parse(result) });
  });

  await ctx.step("unattributed paint listed", async () => {
    const result = await ctx.evalYtm(`JSON.stringify((() => {
      const api = window.__probeTheme;
      const sample = api.sample();
      const missing = [];
      const fillAttributes = [];
      for (const [key, entry] of Object.entries(sample)) {
        if (!entry.found) { missing.push(key); continue; }
        if (entry.fillAttribute) fillAttributes.push(key + ": fill=" + entry.fillAttribute);
      }
      return { missing, fillAttributes };
    })())`);
    ctx.emit("probe-holdouts", JSON.parse(result));
  });
}
