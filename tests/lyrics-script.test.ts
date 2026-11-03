import { requireValue } from "./helpers/require-value";
import { readPageScript, runPageScript } from "./helpers/page-script";
import { Window, type HTMLElement } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const source = await readPageScript("src/addons/bundled/lyrics/scripts/lyrics.script.ts");
const TAB = 'ytmusic-tab-renderer[page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"]';

type Line = { text: string; start: number | null; end: number | null; words?: { text: string; start: number }[] };

let page: Window;
let frames: (() => void)[];
let videoId: string;
let seekTo: ReturnType<typeof vi.fn>;
let video: { currentTime: number };
let tab: HTMLElement;
let scrollTo: ReturnType<typeof vi.fn<HTMLElement["scrollTo"]>>;

function htmlElement(value: unknown): HTMLElement {
  if (!(value instanceof page.HTMLElement)) throw new TypeError("Expected an HTML element in the lyrics fixture");
  return value;
}

const TIMED: Line[] = [
  { text: "first line", start: 1000, end: 3000 },
  { text: "", start: 3000, end: 5000 },
  { text: "third line", start: 5000, end: 8000 },
  {
    text: "hold me close",
    start: 8000,
    end: 11000,
    words: [
      { text: "hold", start: 8000 },
      { text: "me", start: 8500 },
      { text: "close", start: 9000 },
    ],
  },
  { text: "last line", start: 12000, end: 15000 },
];

function run(payload: unknown) {
  return runPageScript(source, payload);
}

function frame(atMs: number) {
  video.currentTime = atMs / 1000;
  const pending = frames;
  frames = [];
  for (const callback of pending) callback();
}

function lines() {
  return [...page.document.querySelectorAll(".ytmd-lyrics-line")].map(htmlElement);
}

function active() {
  return lines().findIndex((line) => line.hasAttribute("aria-current"));
}

beforeEach(() => {
  vi.useFakeTimers();
  page = new Window({ url: "https://music.youtube.com/watch?v=vid" });
  frames = [];
  videoId = "vid";
  seekTo = vi.fn();
  page.document.body.innerHTML = `<ytmusic-app-layout><ytmusic-player-bar></ytmusic-player-bar></ytmusic-app-layout><ytmusic-player-page><ytmusic-tab-renderer page-type="MUSIC_PAGE_TYPE_TRACK_LYRICS"><ytmusic-section-list-renderer>native</ytmusic-section-list-renderer></ytmusic-tab-renderer></ytmusic-player-page><video></video>`;
  const bar = htmlElement(page.document.querySelector("ytmusic-player-bar"));
  Object.assign(bar, { playerApi: { getVideoData: () => ({ video_id: videoId }), seekTo } });
  video = requireValue(page.document.querySelector("video"));
  Object.defineProperty(video, "currentTime", { value: 0, writable: true });
  tab = htmlElement(page.document.querySelector(TAB));
  scrollTo = vi.fn();
  tab.scrollTo = scrollTo;
  vi.stubGlobal("window", page);
  vi.stubGlobal("document", page.document);
  vi.stubGlobal("Element", page.Element);
  vi.stubGlobal("getComputedStyle", page.getComputedStyle.bind(page));
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) => frames.push(callback));
  vi.stubGlobal("cancelAnimationFrame", () => {
    frames = [];
  });
});

afterEach(() => {
  run({ disable: true });
  vi.unstubAllGlobals();
  vi.useRealTimers();
  page.close();
});

describe("lyrics page script", () => {
  it("mounts in the lyrics tab and hides the native view only once lyrics arrive", () => {
    run({ videoId: "vid", pending: true, lines: null });
    expect(tab.classList.contains("ytmd-lyrics-on")).toBe(false);
    run({ videoId: "vid", lines: TIMED, timed: true, source: "Source: Musixmatch" });
    expect(tab.classList.contains("ytmd-lyrics-on")).toBe(true);
    expect(lines().map((line) => line.textContent)).toEqual(["first line", "♪", "third line", "hold me close", "last line"]);
    expect(page.document.querySelector(".ytmd-lyrics-source")?.textContent).toBe("Source: Musixmatch");
  });

  it("stays out of the way when the lyrics belong to another song", () => {
    run({ videoId: "other", lines: TIMED, timed: true });
    expect(tab.classList.contains("ytmd-lyrics-on")).toBe(false);
    videoId = "other";
    vi.advanceTimersByTime(400);
    expect(tab.classList.contains("ytmd-lyrics-on")).toBe(true);
  });

  it("lights the line being sung and marks the ones already passed", () => {
    run({ videoId: "vid", lines: TIMED, timed: true });
    frame(500);
    expect(active()).toBe(-1);
    frame(1000);
    expect(active()).toBe(0);
    frame(5500);
    expect(active()).toBe(2);
    expect(requireValue(lines()[0]).hasAttribute("data-past")).toBe(true);
    expect(requireValue(lines()[4]).hasAttribute("data-past")).toBe(false);
    frame(11500);
    expect(active()).toBe(-1);
    frame(12000);
    expect(active()).toBe(4);
    frame(2000);
    expect(active()).toBe(0);
    expect(requireValue(lines()[2]).hasAttribute("data-past")).toBe(false);
  });

  it("switches lines slightly ahead of the audio", () => {
    run({ videoId: "vid", lines: TIMED, timed: true });
    frame(4870);
    expect(active()).toBe(1);
    frame(4890);
    expect(active()).toBe(2);
  });

  it("fills in words one at a time when the lyrics carry word timings", () => {
    run({ videoId: "vid", lines: TIMED, timed: true });
    const sung = () => [...requireValue(lines()[3]).querySelectorAll(".ytmd-lyrics-word")].map((word) => word.hasAttribute("data-sung"));
    frame(8000);
    expect(sung()).toEqual([true, false, false]);
    frame(8900);
    expect(sung()).toEqual([true, true, true]);
    frame(12000);
    expect(sung()).toEqual([false, false, false]);
  });

  it("seeks to a line when clicked, but not while text is selected", () => {
    run({ videoId: "vid", lines: TIMED, timed: true });
    requireValue(lines()[2]).click();
    expect(seekTo).toHaveBeenCalledWith(5, true);
    requireValue(page.getSelection()).selectAllChildren(requireValue(lines()[2]));
    requireValue(lines()[4]).click();
    expect(seekTo).toHaveBeenCalledTimes(1);
  });

  it("holds auto-scroll after a manual scroll, then returns to the current line", () => {
    run({ videoId: "vid", lines: TIMED, timed: true });
    frame(1000);
    const scrolls = scrollTo;
    scrolls.mockClear();
    tab.dispatchEvent(new page.Event("wheel"));
    frame(5500);
    expect(scrolls).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5100);
    frame(5600);
    expect(scrolls).toHaveBeenCalledTimes(1);
  });

  it("re-anchors the current line when the text size or panel changes", () => {
    run({ videoId: "vid", lines: TIMED, timed: true });
    frame(1000);
    const scrolls = scrollTo;
    scrolls.mockClear();
    vi.advanceTimersByTime(400);
    frame(1100);
    expect(scrolls).not.toHaveBeenCalled();
    htmlElement(page.document.querySelector(".ytmd-lyrics")).style.fontSize = "26px";
    vi.advanceTimersByTime(400);
    frame(1200);
    expect(scrolls).toHaveBeenCalledTimes(1);
    expect(requireValue(scrolls.mock.calls[0])[0]).toMatchObject({ behavior: "auto" });
  });

  it("shows untimed lyrics as plain text with no highlight or click targets", () => {
    run({
      videoId: "vid",
      lines: [
        { text: "a", start: null, end: null },
        { text: "", start: null, end: null },
        { text: "b", start: null, end: null },
      ],
      timed: false,
    });
    expect(tab.classList.contains("ytmd-lyrics-on")).toBe(true);
    expect(page.document.querySelector(".ytmd-lyrics")?.getAttribute("data-timed")).toBe("false");
    expect(requireValue(lines()[1]).hasAttribute("data-gap")).toBe(true);
    expect(page.document.querySelectorAll(".ytmd-lyrics-line[data-start]")).toHaveLength(0);
    expect(frames).toHaveLength(0);
  });

  it("renders oversized text as text, never as markup", () => {
    const hostile = "<img src=x onerror=alert(1)>".repeat(200);
    run({ videoId: "vid", lines: [{ text: hostile, start: 0, end: 1000 }], timed: true, source: hostile });
    expect(page.document.querySelector("img")).toBeNull();
    expect(requireValue(lines()[0]).textContent).toBe(hostile);
  });

  it("gives the native view back on disable and can start again", () => {
    run({ videoId: "vid", lines: TIMED, timed: true });
    expect(run({ disable: true })).toBe(true);
    expect(tab.classList.contains("ytmd-lyrics-on")).toBe(false);
    expect(page.document.querySelector(".ytmd-lyrics")).toBeNull();
    expect(Reflect.get(page, "__ytmdLyrics")).toBeUndefined();
    run({ videoId: "vid", lines: TIMED, timed: true });
    expect(tab.classList.contains("ytmd-lyrics-on")).toBe(true);
  });
});
