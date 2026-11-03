export function runScript(payload: unknown) {
  type Word = { text: string; start: number };
  type Line = { text: string; start: number | null; end: number | null; words?: Word[] };
  type Data = { videoId: string; lines?: Line[] | null; timed?: boolean; source?: string | null };
  type MountedLine = Omit<Line, "text"> & { element: HTMLDivElement; spans: NodeListOf<Element> };
  type State = {
    data: Data | null;
    root: HTMLDivElement | null;
    lines: MountedLine[];
    active: number;
    passed: number;
    word: number;
    frame: number;
    timer: ReturnType<typeof setInterval> | 0;
    holdUntil: number;
    tab: Element | null;
    layout: string;
    snapNext: boolean;
    apply?: (next: unknown) => unknown;
  };
  const pageWindow: Omit<Window, "matchMedia" | "getSelection"> & {
    __ytmdLyrics?: State;
    matchMedia?: Window["matchMedia"];
    getSelection?: Window["getSelection"];
  } = window;
  function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }
  function isWord(value: unknown): value is Word {
    return isRecord(value) && typeof value.text === "string" && typeof value.start === "number";
  }
  function isLine(value: unknown): value is Line {
    return (
      isRecord(value) &&
      typeof value.text === "string" &&
      (value.start === null || typeof value.start === "number") &&
      (value.end === null || typeof value.end === "number") &&
      (value.words === undefined || (Array.isArray(value.words) && value.words.every(isWord)))
    );
  }
  function isData(value: unknown): value is Data {
    return (
      isRecord(value) &&
      typeof value.videoId === "string" &&
      (value.lines === undefined || value.lines === null || (Array.isArray(value.lines) && value.lines.every(isLine))) &&
      (value.timed === undefined || typeof value.timed === "boolean") &&
      (value.source === undefined || value.source === null || typeof value.source === "string")
    );
  }
  function isPlayerApi(value: unknown): value is { getVideoData?: () => unknown; seekTo?: (seconds: number, allowSeekAhead: boolean) => unknown } {
    return (
      isRecord(value) &&
      (value.getVideoData === undefined || typeof value.getVideoData === "function") &&
      (value.seekTo === undefined || typeof value.seekTo === "function")
    );
  }
  function isStore(value: unknown): value is { getState(): unknown } {
    return isRecord(value) && typeof value.getState === "function";
  }
  const existing = pageWindow.__ytmdLyrics;
  if (existing?.apply) return existing.apply(payload);

  const TAB = 'ytmusic-player-page ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]';
  const leadMs = 120;
  const holdMs = 5000;
  const ANCHOR = 0.35;

  const state: State = {
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
    snapNext: true,
  };

  const playerApi = () => {
    const bar = document.querySelector("ytmusic-app-layout>ytmusic-player-bar");
    const api = bar && "playerApi" in bar ? bar.playerApi : undefined;
    return isPlayerApi(api) ? api : undefined;
  };

  const currentVideoId = () => {
    try {
      const api = playerApi();
      const data = api?.getVideoData?.();
      return isRecord(data) && typeof data.video_id === "string" ? data.video_id || null : null;
    } catch (error: unknown) {
      console.warn("Lyrics could not read the current track", error);
      return null;
    }
  };

  const adPlaying = () => {
    try {
      const hook: unknown = Reflect.get(window, "__YTMD_HOOK__");
      const store = isRecord(hook) && isStore(hook.ytmStore) ? hook.ytmStore : undefined;
      const snapshot = store?.getState();
      return isRecord(snapshot) && isRecord(snapshot.player) && Boolean(snapshot.player.adPlaying);
    } catch (error: unknown) {
      console.warn("Lyrics could not read the ad state", error);
      return false;
    }
  };

  const reducedMotion = () => pageWindow.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const hold = () => {
    state.holdUntil = Date.now() + holdMs;
  };

  const holdOnScrollbar = (event: Event) => {
    if (event.target === event.currentTarget) hold();
  };

  const build = () => {
    const root = document.createElement("div");
    root.className = "ytmd-lyrics";
    root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target.closest(".ytmd-lyrics-line[data-start]") : null;
      if (!target) return;
      const selection = pageWindow.getSelection?.();
      if (selection && String(selection).length > 0) return;
      const api = playerApi();
      if (!api?.seekTo) return;
      api.seekTo(Number(target.getAttribute("data-start")) / 1000, true);
      state.holdUntil = 0;
      state.snapNext = false;
    });
    return root;
  };

  const render = () => {
    const data = state.data;
    const root = state.root ?? (state.root = build());
    root.textContent = "";
    state.lines = [];
    state.active = -1;
    state.passed = -1;
    state.word = -1;
    state.snapNext = true;
    root.dataset.timed = data?.timed ? "true" : "false";
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
          element.setAttribute("data-break", "");
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
        element.setAttribute("data-gap", "");
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

  const locate = (time: number) => {
    const lines = state.lines;
    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      const start = lines[mid]?.start;
      if (typeof start === "number" && start <= time) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (found < 0) return { passed: -1, active: -1 };
    const line = lines[found];
    if (!line) return { passed: -1, active: -1 };
    const next = lines[found + 1];
    const isEnded = typeof line.end === "number" && time >= line.end && (!next || typeof next.start !== "number" || next.start > line.end);
    return { passed: found, active: isEnded ? -1 : found };
  };

  const scrollToActive = (isSmooth: boolean) => {
    const tab = state.tab;
    const line = state.lines[state.active] ?? state.lines[state.passed];
    if (!tab || !line) return;
    const offset = line.element.getBoundingClientRect().top - tab.getBoundingClientRect().top + tab.scrollTop;
    const top = Math.max(0, offset - tab.clientHeight * ANCHOR + line.element.offsetHeight / 2);
    tab.scrollTo({ top: top, behavior: isSmooth && !reducedMotion() ? "smooth" : "auto" });
  };

  const tick = () => {
    state.frame = 0;
    const tab = state.tab;
    if (!tab || !state.root || !state.root.isConnected || !state.data || !state.data.timed || tab.getClientRects().length === 0) return;

    const video = document.querySelector("video");
    const time = video && !adPlaying() ? video.currentTime * 1000 + leadMs : -1;
    const spot = time < 0 ? { passed: -1, active: -1 } : locate(time);

    if (spot.active !== state.active || spot.passed !== state.passed) {
      const from = Math.min(state.passed, spot.passed);
      const to = Math.max(state.passed, spot.passed);
      for (let index = Math.max(0, from); index <= to && index < state.lines.length; index++) {
        state.lines[index]?.element.toggleAttribute("data-past", index <= spot.passed && index !== spot.active);
      }
      const activeLine = state.lines[state.active];
      if (state.active >= 0 && activeLine) {
        activeLine.element.removeAttribute("aria-current");
        for (const span of activeLine.spans) span.removeAttribute("data-sung");
      }
      if (spot.active >= 0) state.lines[spot.active]?.element.setAttribute("aria-current", "true");
      const isMoved = spot.active >= 0 && spot.active !== state.active;
      state.active = spot.active;
      state.passed = spot.passed;
      state.word = -1;
      if (isMoved && !state.snapNext && Date.now() >= state.holdUntil) scrollToActive(true);
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
    if (line?.spans.length === line?.words?.length && line?.words) {
      let sung = -1;
      while (sung + 1 < line.words.length && (line.words[sung + 1]?.start ?? Infinity) <= time) sung++;
      if (sung !== state.word) {
        line.spans.forEach((span, index) => span.toggleAttribute("data-sung", index <= sung));
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
    if (!tab) return;
    const data = state.data;
    if (!data) {
      tab.classList.remove("ytmd-lyrics-on");
      return;
    }
    const isShowing = data.videoId === currentVideoId() && Array.isArray(data.lines);
    if (!isShowing || !state.root) {
      tab.classList.remove("ytmd-lyrics-on");
      return;
    }
    if (state.root.parentNode !== tab) {
      tab.appendChild(state.root);
      state.snapNext = true;
    }
    tab.classList.add("ytmd-lyrics-on");
    const isVisible = tab.getClientRects().length > 0;
    if (!isVisible) state.snapNext = true;
    const layout = `${tab.clientHeight}x${state.root.clientWidth}x${getComputedStyle(state.root).fontSize}`;
    if (layout !== state.layout) {
      state.layout = layout;
      state.snapNext = true;
    }
    state.root.style.setProperty("--ytmd-lyrics-tail", `${Math.round(tab.clientHeight * (1 - ANCHOR))}px`);
    if (isVisible && data.timed && !state.frame) state.frame = requestAnimationFrame(tick);
  };

  state.apply = (next: unknown) => {
    if (isRecord(next) && next.disable) {
      clearInterval(state.timer);
      if (state.frame) cancelAnimationFrame(state.frame);
      if (state.tab) state.tab.classList.remove("ytmd-lyrics-on");
      if (state.root) state.root.remove();
      delete pageWindow.__ytmdLyrics;
      return true;
    }
    if (isData(next)) {
      state.data = next;
      render();
      sync();
    }
    return { videoId: currentVideoId(), mounted: !!state.root?.isConnected, active: state.active };
  };

  state.root = build();
  state.timer = setInterval(sync, 400);
  pageWindow.__ytmdLyrics = state;
  return state.apply(payload);
}
