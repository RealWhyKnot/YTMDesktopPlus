export function recorder(options: { trapStore?: boolean }) {
  const member = (value: unknown, key: string): unknown =>
    value !== null && (typeof value === "object" || typeof value === "function") ? Reflect.get(value, key) : undefined;
  const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
  const object = (value: unknown): Record<string, unknown> => {
    if (!isObject(value)) throw new Error("Expected a recorder object");
    return value;
  };
  const arrayValues = (value: unknown): unknown[] => {
    if (!Array.isArray(value)) throw new Error("Expected recorder entries");
    return value;
  };
  const callable = (value: unknown): value is (...args: unknown[]) => unknown => typeof value === "function";
  const call = (value: unknown, key: string, ...args: unknown[]): unknown => {
    const method = member(value, key);
    if (!callable(method)) throw new Error(`Recorder method ${key} is missing`);
    return method.apply(value, args);
  };
  if (member(window, "__fs")) return;
  const playerBar = "ytmusic-app-layout>ytmusic-player-bar";
  const log: { at: number; kind: string; [key: string]: unknown }[] = [];
  const fs: { t0: number; log: typeof log; samples: Record<string, unknown>[]; mediaCount: number; wrapperPath?: string } = {
    t0: Date.now(),
    log,
    samples: [],
    mediaCount: 0,
  };
  Reflect.set(window, "__fs", fs);
  const push = (kind: string, data: Record<string, unknown> | null) => {
    if (log.length < 8000) log.push({ at: Date.now(), kind, ...data });
  };
  const round = (value: unknown) => (typeof value === "number" ? Math.round(value * 100) / 100 : value);
  const attempt = <T, F = null>(fn: () => T, fallback: F | null = null): T | F | null => {
    try {
      return fn();
    } catch {
      return fallback;
    }
  };

  window.addEventListener(
    "error",
    (event) => {
      if (!(event instanceof ErrorEvent)) return;
      const stack: unknown = member(event.error, "stack") ?? "";
      push("error", {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        col: event.colno,
        stack: String(stack).slice(0, 2000),
      });
    },
    true
  );
  window.addEventListener("unhandledrejection", (event) => push("rejection", { reason: String(member(event.reason, "stack") ?? event.reason).slice(0, 2000) }));

  const mediaEvents = [
    "loadstart",
    "emptied",
    "loadedmetadata",
    "loadeddata",
    "canplay",
    "play",
    "playing",
    "pause",
    "waiting",
    "seeking",
    "seeked",
    "ended",
    "error",
    "abort",
    "stalled",
    "ratechange",
    "volumechange",
  ];
  for (const type of mediaEvents) {
    document.addEventListener(
      type,
      (event) => {
        const media = event.target;
        if (!(media instanceof HTMLMediaElement)) return;
        if (member(media, "__fsId") == null) Reflect.set(media, "__fsId", ++fs.mediaCount);
        push("media", {
          type,
          id: member(media, "__fsId"),
          cur: round(media.currentTime),
          dur: round(media.duration),
          paused: media.paused,
          rs: media.readyState,
          rate: media.playbackRate,
          muted: media.muted,
        });
      },
      true
    );
  }

  const bar = () => document.querySelector(playerBar);
  const movie = () => {
    const element = document.querySelector("#movie_player");
    return element && typeof member(element, "getPlayerState") === "function" ? element : null;
  };
  let trapped: unknown = null;
  if (options.trapStore) {
    const capture = function (this: unknown) {
      try {
        if (!trapped && typeof member(member(this, "store"), "getState") === "function") trapped = member(this, "store");
      } catch {
        trapped = null;
      }
    };
    Object.defineProperty(window, "PolymerFakeBaseClassWithoutHtml", {
      configurable: true,
      get: () => capture,
      set() {
        return undefined;
      },
    });
  }
  let resolved: unknown = null;
  let isResolving = false;
  const resolveApi = () => {
    const element = bar();
    if (resolved || isResolving || typeof member(element, "resolvePlayerApi") !== "function") return resolved;
    isResolving = true;
    void Promise.resolve(call(element, "resolvePlayerApi"))
      .then(
        (api) => {
          resolved = api ?? null;
          isResolving = false;
        },
        () => {
          isResolving = false;
        }
      )
      .catch((error: unknown) => console.warn("recorder failed", error));
    return resolved;
  };
  const api = () => member(bar(), "playerApi") ?? resolveApi() ?? movie();
  Reflect.set(fs, "api", api);
  const store = () => member(member(window, "__YTMD_HOOK__"), "ytmStore") ?? trapped;
  Reflect.set(fs, "store", store);

  const entryRenderer = (entry: unknown) =>
    member(entry, "playlistPanelVideoRenderer") ??
    member(member(member(entry, "playlistPanelVideoWrapperRenderer"), "primaryRenderer"), "playlistPanelVideoRenderer") ??
    null;
  const scalars = (input: unknown) => {
    const out = new Map<string, unknown>();
    for (const [key, value] of Object.entries(object(input ?? {}))) {
      if (value === null || typeof value !== "object") out.set(key, typeof value === "string" ? value.slice(0, 60) : value);
    }
    return Object.fromEntries(out);
  };
  const describeEntry = (entry: unknown) => {
    const wrapper = member(entry, "playlistPanelVideoWrapperRenderer");
    const primary = entryRenderer(entry);
    const length = (renderer: unknown) => member(member(member(member(renderer, "lengthText"), "runs"), "0"), "text") ?? null;
    return {
      videoId: member(primary, "videoId") ?? null,
      length: length(primary),
      counterparts: arrayValues(member(wrapper, "counterpart") ?? []).map((counterpart) => {
        const renderer = member(member(counterpart, "counterpartRenderer"), "playlistPanelVideoRenderer");
        return {
          videoId: member(renderer, "videoId") ?? null,
          length: length(renderer),
          segmentMap: JSON.stringify(member(counterpart, "segmentMap") ?? null).slice(0, 600),
        };
      }),
    };
  };
  const selected = (queue: unknown) => {
    const all = [...arrayValues(member(queue, "items") ?? []), ...arrayValues(member(queue, "automixItems") ?? [])].map(entryRenderer);
    const index = all.findIndex((renderer) => member(renderer, "selected"));
    return { all, index };
  };
  const describeQueue = (queue: unknown) => {
    if (!queue) return null;
    const { all, index } = selected(queue);
    return {
      items: member(member(queue, "items"), "length") ?? 0,
      automix: member(member(queue, "automixItems"), "length") ?? 0,
      sel: index,
      cur: member(all[index], "videoId") ?? null,
      next: member(all[index + 1], "videoId") ?? null,
      ...scalars(queue),
    };
  };
  Reflect.set(fs, "queue", describeQueue);

  let wrapper: Record<string, unknown> | null = null;
  const findWrapper = () => {
    const seen = new Set<unknown>();
    let frontier: { value: object; path: string }[] = [
      ...document.querySelectorAll("ytmusic-app, ytmusic-app-layout, ytmusic-player-bar, ytmusic-player, ytmusic-player-page"),
    ].map((element) => ({
      value: element,
      path: element.tagName.toLowerCase(),
    }));
    for (let depth = 0; depth < 3; depth++) {
      const next: { value: object; path: string }[] = [];
      for (const { value, path } of frontier) {
        const names = attempt(() => Object.getOwnPropertyNames(value), []) ?? [];
        for (const name of names) {
          const child = attempt(() => member(value, name));
          if (!child || typeof child !== "object" || child instanceof Node || seen.has(child) || (Array.isArray(child) && child.length > 50)) continue;
          seen.add(child);
          if (Object.prototype.hasOwnProperty.call(child, "counterpartTrackMs")) {
            fs.wrapperPath = `${path}.${name}`;
            return object(child);
          }
          if (next.length < 20000) next.push({ value: child, path: `${path}.${name}` });
        }
      }
      frontier = next;
    }
    return null;
  };
  const counterpart = () => (wrapper ? { trackMs: wrapper.counterpartTrackMs, op: wrapper.operationType } : null);
  Reflect.set(fs, "counterpart", counterpart);
  let wrapperTries = 0;
  const watchWrapper = setInterval(() => {
    wrapper = attempt(findWrapper);
    if (wrapper) push("wrapper-found", { path: fs.wrapperPath, ...counterpart() });
    if (wrapper || ++wrapperTries > 40) clearInterval(watchWrapper);
  }, 500);
  let lastCounterpart: unknown = 0;

  const watchStore = setInterval(() => {
    const found = store();
    if (!found) return;
    clearInterval(watchStore);
    let state = object(call(found, "getState"));
    push("store-ready", { slices: Object.keys(state), player: scalars(state.player), queue: describeQueue(state.queue) });
    call(found, "subscribe", () => {
      const next = object(call(found, "getState"));
      if (next.queue !== state.queue) push("queue", describeQueue(next.queue));
      if (wrapper && wrapper.counterpartTrackMs !== lastCounterpart) {
        lastCounterpart = wrapper.counterpartTrackMs;
        push("counterpart", counterpart());
      }
      if (next.player !== state.player) {
        const before = scalars(state.player);
        const after = scalars(next.player);
        const changed = new Map<string, unknown>();
        for (const key of Object.keys(after)) if (after[key] !== before[key]) changed.set(key, after[key]);
        if (changed.size > 0) push("player", Object.fromEntries(changed));
      }
      state = next;
    });
    const dispatch = member(found, "dispatch");
    if (!callable(dispatch)) throw new Error("Recorder dispatch is missing");
    object(found).dispatch = function (this: unknown, ...args: unknown[]) {
      const action = args[0];
      if (action && typeof member(action, "type") === "string") push("action", { type: member(action, "type") });
      return dispatch.apply(this, args);
    };
  }, 50);

  const watchApi = setInterval(() => {
    const player = movie();
    if (!player || typeof member(player, "addEventListener") !== "function") return;
    clearInterval(watchApi);
    const videoId = () => attempt(() => member(call(player, "getVideoData"), "video_id") ?? null);
    push("api-ready", {});
    call(player, "addEventListener", "onStateChange", (state: unknown) =>
      push("state", { state, videoId: videoId(), cur: round(attempt(() => call(player, "getCurrentTime"))) })
    );
    call(player, "addEventListener", "onVideoDataChange", (event: unknown) =>
      push("data", { type: member(event, "type"), playertype: member(event, "playertype"), videoId: videoId() })
    );
    call(player, "addEventListener", "onError", (error: unknown) => push("player-error", { error: String(error) }));
  }, 50);

  const read = () => {
    const player = api();
    if (!player) return null;
    const video = document.querySelector<HTMLVideoElement>("#movie_player video") ?? document.querySelector("video");
    const state = attempt(() => {
      const found = store();
      return found ? object(call(found, "getState")) : undefined;
    });
    return {
      videoId: attempt(() => member(call(player, "getVideoData"), "video_id") ?? null),
      cur: round(attempt(() => call(player, "getCurrentTime"))),
      dur: round(attempt(() => call(player, "getDuration"))),
      state: attempt(() => call(player, "getPlayerState")),
      ad: member(state?.player, "adPlaying") === true,
      qCur: state
        ? (() => {
            const { all, index } = selected(state.queue);
            return member(all[index], "videoId") ?? null;
          })()
        : null,
      vCur: round(video?.currentTime),
      vPaused: video?.paused ?? null,
      vRate: video?.playbackRate ?? null,
      vRs: video?.readyState ?? null,
    };
  };
  Reflect.set(fs, "read", read);

  const setup = () => ({
    hook: !!member(window, "__YTMD_HOOK__"),
    nonStop: !!member(window, "__ytmdNonStop"),
    adSkip: !!member(window, "__ytmdAdSkip"),
    adPrune: member(window, "__ytmdAdPrune")
      ? { enabled: member(member(window, "__ytmdAdPrune"), "enabled"), count: member(member(window, "__ytmdAdPrune"), "count") }
      : null,
    audioGraph: !!member(window, "__ytmdAudioGraph"),
    arrows: !!document.querySelector(".ytmd-history-back"),
    sleepTimer: !!document.querySelector(".sleep-timer-button"),
    via: member(bar(), "__ytmdPlayerApiVia") ?? null,
    apiIsMovie: api() === movie(),
    videos: document.querySelectorAll("video").length,
  });
  Reflect.set(fs, "setup", setup);

  const arm = (method: string, atS: number, windowMs: number) =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000;
      const tick = () => {
        const now = read();
        if (now?.state === 1 && !now.ad && Number(now.cur) >= atS) {
          const player = api();
          const queue = attempt(() => {
            const found = store();
            return found ? object(call(found, "getState")).queue : undefined;
          });
          Reflect.set(fs, "queue", describeQueue);
          const entries = [...arrayValues(member(queue, "items") ?? []), ...arrayValues(member(queue, "automixItems") ?? [])];
          const { index } = selected(queue);
          const pre = {
            currentEntry: attempt(() => describeEntry(entries[index])),
            nextEntry: attempt(() => describeEntry(entries[index + 1])),
            ...now,
            len: Number(attempt(() => member(member(call(player, "getPlayerResponse"), "videoDetails"), "lengthSeconds"))) || 0,
            loaded: round(attempt(() => call(player, "getVideoLoadedFraction"))),
            queue: describeQueue(queue),
            setup: setup(),
            counterpart: counterpart(),
            docAgeMs: Date.now() - fs.t0,
          };
          const pressAt = Date.now();
          if (method === "button") call(bar()?.querySelector(".next-button"), "click");
          else if (method === "api") call(player, "nextVideo");
          fs.samples = [];
          const timer = setInterval(() => {
            fs.samples.push({ t: Date.now() - pressAt, ...read(), ctm: wrapper ? wrapper.counterpartTrackMs : null });
            if (Date.now() - pressAt >= windowMs) clearInterval(timer);
          }, 100);
          resolve({ pre, pressAt });
        } else if (Date.now() > deadline) {
          reject(new Error("press point not reached: " + JSON.stringify(now)));
        } else {
          setTimeout(tick, 5);
        }
      };
      tick();
    });
  Reflect.set(fs, "arm", arm);

  const dump = () => ({ t0: fs.t0, log, samples: fs.samples, setup: setup(), ua: navigator.userAgent });
  Reflect.set(fs, "dump", dump);
}
