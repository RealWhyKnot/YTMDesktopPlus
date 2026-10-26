(function (payload) {
  const existing = window.__ytmdLyrics;
  if (existing) return existing.apply(payload);

  const TAB = 'ytmusic-player-page ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]';
  const LEAD_MS = 120;
  const HOLD_MS = 5000;
  const ANCHOR = 0.35;

  const state = {
    data: null,
    root: null,
    lines: [],
    active: -1,
    passed: -1,
    word: -1,
    frame: 0,
    timer: 0,
    holdUntil: 0,
    tab: null,
    layout: "",
    snapNext: true
  };

  const playerApi = () => {
    const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    return bar && bar.playerApi;
  };

  const currentVideoId = () => {
    try {
      const api = playerApi();
      const data = api && api.getVideoData && api.getVideoData();
      return (data && data.video_id) || null;
    } catch {
      return null;
    }
  };

  const adPlaying = () => {
    try {
      const hook = window.__YTMD_HOOK__;
      return !!(hook && hook.ytmStore.getState().player.adPlaying);
    } catch {
      return false;
    }
  };

  const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const hold = () => {
    state.holdUntil = Date.now() + HOLD_MS;
  };

  const holdOnScrollbar = event => {
    if (event.target === event.currentTarget) hold();
  };

  const build = () => {
    const root = document.createElement("div");
    root.className = "ytmd-lyrics";
    root.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target.closest(".ytmd-lyrics-line[data-start]") : null;
      if (!target) return;
      const selection = window.getSelection && window.getSelection();
      if (selection && String(selection).length > 0) return;
      const api = playerApi();
      if (!api || !api.seekTo) return;
      api.seekTo(Number(target.dataset.start) / 1000, true);
      state.holdUntil = 0;
      state.snapNext = false;
    });
    return root;
  };

  const render = () => {
    const data = state.data;
    const root = state.root || (state.root = build());
    root.textContent = "";
    state.lines = [];
    state.active = -1;
    state.passed = -1;
    state.word = -1;
    state.snapNext = true;
    root.dataset.timed = data && data.timed ? "true" : "false";
    if (!data || !Array.isArray(data.lines)) return;

    const list = document.createElement("div");
    list.className = "ytmd-lyrics-lines";
    for (const line of data.lines) {
      const element = document.createElement("div");
      element.className = "ytmd-lyrics-line";
      element.dir = "auto";
      const text = typeof line.text === "string" ? line.text : "";
      if (data.timed && typeof line.start === "number") {
        element.dataset.start = String(line.start);
        if (!text) {
          element.classList.add("is-break");
          element.textContent = "♪";
        } else if (Array.isArray(line.words) && line.words.length > 0) {
          line.words.forEach((word, index) => {
            if (index > 0) element.appendChild(document.createTextNode(" "));
            const span = document.createElement("span");
            span.className = "ytmd-lyrics-word";
            span.textContent = word.text;
            element.appendChild(span);
          });
        } else {
          element.textContent = text;
        }
      } else if (!text) {
        element.classList.add("is-gap");
      } else {
        element.textContent = text;
      }
      list.appendChild(element);
      state.lines.push({ element: element, start: line.start, end: line.end, words: line.words, spans: element.querySelectorAll(".ytmd-lyrics-word") });
    }
    root.appendChild(list);

    if (data.source) {
      const source = document.createElement("div");
      source.className = "ytmd-lyrics-source";
      source.textContent = data.source;
      root.appendChild(source);
    }
  };

  const locate = time => {
    const lines = state.lines;
    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = lines[mid].start;
      if (typeof start === "number" && start <= time) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (found < 0) return { passed: -1, active: -1 };
    const line = lines[found];
    const next = lines[found + 1];
    const ended = typeof line.end === "number" && time >= line.end && (!next || typeof next.start !== "number" || next.start > line.end);
    return { passed: found, active: ended ? -1 : found };
  };

  const scrollToActive = smooth => {
    const tab = state.tab;
    const line = state.lines[state.active] || state.lines[state.passed];
    if (!tab || !line) return;
    const offset = line.element.getBoundingClientRect().top - tab.getBoundingClientRect().top + tab.scrollTop;
    const top = Math.max(0, offset - tab.clientHeight * ANCHOR + line.element.offsetHeight / 2);
    tab.scrollTo({ top: top, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
  };

  const tick = () => {
    state.frame = 0;
    const tab = state.tab;
    if (!tab || !state.root || !state.root.isConnected || !state.data || !state.data.timed || tab.getClientRects().length === 0) return;

    const video = document.querySelector("video");
    const time = video && !adPlaying() ? video.currentTime * 1000 + LEAD_MS : -1;
    const spot = time < 0 ? { passed: -1, active: -1 } : locate(time);

    if (spot.active !== state.active || spot.passed !== state.passed) {
      const from = Math.min(state.passed, spot.passed);
      const to = Math.max(state.passed, spot.passed);
      for (let index = Math.max(0, from); index <= to && index < state.lines.length; index++) {
        state.lines[index].element.classList.toggle("is-past", index <= spot.passed && index !== spot.active);
      }
      if (state.active >= 0 && state.lines[state.active]) {
        state.lines[state.active].element.classList.remove("is-active");
        for (const span of state.lines[state.active].spans) span.classList.remove("is-sung");
      }
      if (spot.active >= 0) state.lines[spot.active].element.classList.add("is-active");
      const moved = spot.active >= 0 && spot.active !== state.active;
      state.active = spot.active;
      state.passed = spot.passed;
      state.word = -1;
      if (moved && !state.snapNext && Date.now() >= state.holdUntil) scrollToActive(true);
    }

    if (state.snapNext && Date.now() >= state.holdUntil) {
      scrollToActive(false);
      state.snapNext = false;
    }

    if (state.holdUntil && Date.now() >= state.holdUntil) {
      state.holdUntil = 0;
      scrollToActive(true);
    }

    const line = state.lines[state.active];
    if (line && line.words && line.spans.length === line.words.length) {
      let sung = -1;
      while (sung + 1 < line.words.length && line.words[sung + 1].start <= time) sung++;
      if (sung !== state.word) {
        line.spans.forEach((span, index) => span.classList.toggle("is-sung", index <= sung));
        state.word = sung;
      }
    }

    state.frame = requestAnimationFrame(tick);
  };

  const sync = () => {
    const tab = document.querySelector(TAB);
    if (tab !== state.tab) {
      if (state.tab) state.tab.classList.remove("ytmd-lyrics-on");
      state.tab = tab;
      state.snapNext = true;
      if (tab) {
        tab.addEventListener("wheel", hold, { passive: true });
        tab.addEventListener("touchmove", hold, { passive: true });
        tab.addEventListener("keydown", hold);
        tab.addEventListener("pointerdown", holdOnScrollbar);
      }
    }
    const data = state.data;
    const showing = !!(tab && data && data.videoId === currentVideoId() && Array.isArray(data.lines));
    if (!tab) return;
    if (!showing) {
      tab.classList.remove("ytmd-lyrics-on");
      return;
    }
    if (state.root.parentNode !== tab) {
      tab.appendChild(state.root);
      state.snapNext = true;
    }
    tab.classList.add("ytmd-lyrics-on");
    const visible = tab.getClientRects().length > 0;
    if (!visible) state.snapNext = true;
    const layout = tab.clientHeight + "x" + state.root.clientWidth + "x" + getComputedStyle(state.root).fontSize;
    if (layout !== state.layout) {
      state.layout = layout;
      state.snapNext = true;
    }
    state.root.style.setProperty("--ytmd-lyrics-tail", Math.round(tab.clientHeight * (1 - ANCHOR)) + "px");
    if (visible && data.timed && !state.frame) state.frame = requestAnimationFrame(tick);
  };

  state.apply = next => {
    if (next && next.disable) {
      clearInterval(state.timer);
      if (state.frame) cancelAnimationFrame(state.frame);
      if (state.tab) state.tab.classList.remove("ytmd-lyrics-on");
      if (state.root) state.root.remove();
      delete window.__ytmdLyrics;
      return true;
    }
    if (next && typeof next.videoId === "string") {
      state.data = next;
      render();
      sync();
    }
    return { videoId: currentVideoId(), mounted: !!(state.root && state.root.isConnected), active: state.active };
  };

  state.root = build();
  state.timer = setInterval(sync, 400);
  window.__ytmdLyrics = state;
  return state.apply(payload);
});
