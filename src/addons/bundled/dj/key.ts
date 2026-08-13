// Musical key from a track-averaged chromagram: Krumhansl-Schmuckler profile
// correlation over all 24 rotations, mapped onto the Camelot wheel.

export type KeyEstimate = {
  // 0 = C ... 11 = B
  tonic: number;
  scale: "major" | "minor";
  // Camelot position 1-12 plus letter, e.g. "8B" for C major
  camelot: string;
  // Correlation of the winner, -1..1; and the margin over the runner-up
  confidence: number;
  margin: number;
};

const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Camelot number for tonic 0..11; majors are B, minors are A.
const CAMELOT_MAJOR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
const CAMELOT_MINOR = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function correlate(chroma: number[], profile: number[], rotation: number): number {
  const n = 12;
  let meanX = 0;
  let meanY = 0;
  for (let i = 0; i < n; i++) {
    meanX += chroma[i];
    meanY += profile[i];
  }
  meanX /= n;
  meanY /= n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const x = chroma[(i + rotation) % n] - meanX;
    const y = profile[i] - meanY;
    num += x * y;
    denX += x * x;
    denY += y * y;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

export function estimateKey(chroma: number[]): KeyEstimate | null {
  if (!Array.isArray(chroma) || chroma.length !== 12 || chroma.some(v => !isFinite(v))) return null;
  if (chroma.every(v => v === 0)) return null;

  const scores: { tonic: number; scale: "major" | "minor"; score: number }[] = [];
  for (let tonic = 0; tonic < 12; tonic++) {
    scores.push({ tonic, scale: "major", score: correlate(chroma, MAJOR_PROFILE, tonic) });
    scores.push({ tonic, scale: "minor", score: correlate(chroma, MINOR_PROFILE, tonic) });
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const camelotNumber = best.scale === "major" ? CAMELOT_MAJOR[best.tonic] : CAMELOT_MINOR[best.tonic];
  return {
    tonic: best.tonic,
    scale: best.scale,
    camelot: `${camelotNumber}${best.scale === "major" ? "B" : "A"}`,
    confidence: best.score,
    margin: best.score - scores[1].score
  };
}

export function keyName(estimate: KeyEstimate): string {
  return `${NOTE_NAMES[estimate.tonic]} ${estimate.scale}`;
}

// Harmonic closeness on the Camelot wheel, 0..1. Same slot 1, ring neighbour
// or relative major/minor high, two steps out still workable, anything else low.
export function camelotAffinity(a: string, b: string): number {
  const parse = (value: string) => {
    const match = /^([1-9]|1[0-2])([AB])$/.exec(value);
    return match ? { num: Number(match[1]), letter: match[2] } : null;
  };
  const ka = parse(a);
  const kb = parse(b);
  if (!ka || !kb) return 0.2;
  const ringDistance = Math.min((ka.num - kb.num + 12) % 12, (kb.num - ka.num + 12) % 12);
  if (ringDistance === 0) return ka.letter === kb.letter ? 1 : 0.85;
  if (ringDistance === 1 && ka.letter === kb.letter) return 0.9;
  if (ringDistance === 2 && ka.letter === kb.letter) return 0.5;
  return 0.2;
}
