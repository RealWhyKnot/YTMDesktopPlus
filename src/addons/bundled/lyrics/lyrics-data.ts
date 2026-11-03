import { isArray, isRecord } from "~shared/unknown";

export type LyricWord = { text: string; start: number };

export type LyricLine = { text: string; start: number | null; end: number | null; words?: LyricWord[] };

export type Lyrics = { lines: LyricLine[]; timed: boolean; source: string };

export type YtmTimedLine = { lyricLine?: unknown; cueRange?: { startTimeMilliseconds?: unknown; endTimeMilliseconds?: unknown } };

export type LrclibRecord = {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

export const MAX_LINES = 400;
export const MAX_LINE_LENGTH = 500;
export const DURATION_TOLERANCE_SECONDS = 2;
export const MIN_TEXT_MATCH = 0.6;

const TIMESTAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g;
const WORD_TIMESTAMP = /<(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)>/g;

function toMs(minutes: string | undefined, seconds: string | undefined): number {
  if (minutes === undefined || seconds === undefined) throw new Error("Missing lyric timestamp capture");
  return Math.round((Number(minutes) * 60 + Number(seconds.replace(":", "."))) * 1000);
}

function clip(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  return trimmed.length > MAX_LINE_LENGTH ? trimmed.slice(0, MAX_LINE_LENGTH) : trimmed;
}

function finishLines(lines: LyricLine[]): LyricLine[] {
  const capped = lines.slice(0, MAX_LINES);
  for (const [index, line] of capped.entries()) {
    if (line.end === null && line.start !== null) {
      const next = capped[index + 1];
      line.end = next && next.start !== null ? next.start : null;
    }
  }
  return capped;
}

function parseWords(body: string, lineStart: number): { text: string; words?: LyricWord[] } {
  const marks = [...body.matchAll(WORD_TIMESTAMP)];
  const first = marks[0];
  if (first === undefined) return { text: clip(body) };

  const words: LyricWord[] = [];
  const lead = body.slice(0, first.index).trim();
  if (lead) words.push({ text: lead, start: lineStart });
  for (const [index, mark] of marks.entries()) {
    const from = mark.index + mark[0].length;
    const to = marks[index + 1]?.index ?? body.length;
    const text = body.slice(from, to).replace(/\s+/g, " ").trim();
    if (text) words.push({ text, start: toMs(mark[1], mark[2]) });
  }
  const text = clip(words.map((word) => word.text).join(" "));
  return words.length > 0 ? { text, words } : { text };
}

export function parseLrc(lrc: string): LyricLine[] {
  let offset = 0;
  const lines: LyricLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const offsetTag = /^\s*\[offset:\s*([+-]?\d+)\s*\]/i.exec(raw);
    if (offsetTag) {
      offset = Number(offsetTag[1]);
      continue;
    }
    const stamps = [...raw.matchAll(TIMESTAMP)];
    const last = stamps[stamps.length - 1];
    if (last === undefined) continue;
    const body = raw.slice(last.index + last[0].length);
    for (const stamp of stamps) {
      const start = Math.max(0, toMs(stamp[1], stamp[2]) - offset);
      const parsed = parseWords(body, start);
      lines.push({
        text: parsed.text,
        start,
        end: null,
        ...(parsed.words && stamps.length === 1 ? { words: parsed.words.map((word) => ({ ...word, start: Math.max(0, word.start - offset) })) } : {}),
      });
    }
  }
  lines.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
  return finishLines(lines);
}

export function fromYtmTimed(data: unknown): Lyrics | null {
  if (!isArray(data) || data.length === 0) return null;
  const lines: LyricLine[] = [];
  let isTimed = true;
  for (const raw of data) {
    const entry = isRecord(raw) ? raw : undefined;
    const cueRange = isRecord(entry?.cueRange) ? entry.cueRange : undefined;
    const text = typeof entry?.lyricLine === "string" ? clip(entry.lyricLine) : "";
    const start = Number(cueRange?.startTimeMilliseconds);
    const end = Number(cueRange?.endTimeMilliseconds);
    const hasTime = cueRange !== undefined && Number.isFinite(start);
    if (!hasTime) isTimed = false;
    lines.push({ text, start: hasTime ? start : null, end: hasTime && Number.isFinite(end) ? end : null });
  }
  if (!isTimed) {
    for (const line of lines) {
      line.start = null;
      line.end = null;
    }
  }
  return { lines: finishLines(lines), timed: isTimed, source: "" };
}

export function plainLines(text: string): LyricLine[] {
  return finishLines(text.split(/\r?\n/).map((line): LyricLine => ({ text: clip(line), start: null, end: null })));
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function textMatch(a: string, b: string): number {
  const left = words(a);
  const right = words(b);
  if (left.length === 0 || right.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const word of left) counts.set(word, (counts.get(word) ?? 0) + 1);
  let shared = 0;
  for (const word of right) {
    const count = counts.get(word) ?? 0;
    if (count > 0) {
      shared++;
      counts.set(word, count - 1);
    }
  }
  return shared / Math.max(left.length, right.length);
}

export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([](?:[^)\]]*\b(?:official|video|audio|lyrics?|visuali[sz]er|mv|hd|4k|remaster(?:ed)?)\b[^)\]]*)[)\]]/gi, "")
    .replace(/\s*\|.*$/, "")
    .trim();
}

export function cleanArtist(artist: string): string {
  return (
    artist
      .replace(/\s*-\s*Topic$/i, "")
      .replace(/VEVO$/i, "")
      .split(/\s*(?:,|&|\bfeat\.?|\bft\.?|\bx\b)\s*/i)[0] ?? ""
  ).trim();
}

export function pickLrclib(records: unknown, target: { durationSeconds: number; referenceText: string | null }): Lyrics | null {
  type Candidate = { lines: LyricLine[]; text: string; durationGap: number; score: number };
  const candidates: Candidate[] = [];
  for (const record of isArray(records) ? records : []) {
    if (!isRecord(record) || record.instrumental || typeof record.syncedLyrics !== "string") continue;
    const durationGap = Math.abs(Number(record.duration) - target.durationSeconds);
    if (!(durationGap <= DURATION_TOLERANCE_SECONDS)) continue;
    const lines = parseLrc(record.syncedLyrics);
    const sung = lines.filter((line) => line.text.length > 0);
    if (sung.length < 4) continue;
    if ((lines.at(-1)?.start ?? 0) > (target.durationSeconds + DURATION_TOLERANCE_SECONDS) * 1000) continue;
    candidates.push({ lines, text: sung.map((line) => line.text).join("\n"), durationGap, score: 0 });
  }
  if (candidates.length === 0) return null;

  for (const candidate of candidates) {
    if (target.referenceText) {
      candidate.score = textMatch(candidate.text, target.referenceText);
    } else {
      const others = candidates.filter((other) => other !== candidate);
      candidate.score = others.length === 0 ? 1 : Math.max(...others.map((other) => textMatch(candidate.text, other.text)));
    }
  }
  const viable = candidates.filter((candidate) => candidate.score >= MIN_TEXT_MATCH);
  if (viable.length === 0) return null;
  viable.sort((a, b) => b.score - a.score || a.durationGap - b.durationGap || b.lines.length - a.lines.length);
  const best = viable[0];
  return best === undefined ? null : { lines: best.lines, timed: true, source: "LRCLIB" };
}
