export const CONTRAST_PAIRS: Array<[string, string, number]> = [
  ["--ytmd-text", "--ytmd-bg", 4.5],
  ["--ytmd-text", "--ytmd-surface", 4.5],
  ["--ytmd-text", "--ytmd-elevated", 4.5],
  ["--ytmd-text-muted", "--ytmd-bg", 4.5],
  ["--ytmd-text-muted", "--ytmd-surface", 4.5],
  ["--ytmd-text-faint", "--ytmd-bg", 3],
  ["--ytmd-icon", "--ytmd-bg", 3],
  ["--ytmd-icon", "--ytmd-surface", 3],
  ["--ytmd-icon-muted", "--ytmd-bg", 3],
  ["--ytmd-accent", "--ytmd-bg", 3],
  ["--ytmd-on-accent", "--ytmd-accent", 3],
  ["--text", "--bg", 4.5],
  ["--text", "--bg-raised", 4.5],
  ["--text", "--bg-control", 4.5],
  ["--text-muted", "--bg", 4.5],
  ["--text-faint", "--bg", 3]
];

export function resolveToken(tokens: Record<string, string>, name: string, depth = 0): string | null {
  const raw = tokens[name];
  if (raw === undefined || depth > 8) return null;
  const value = raw.trim();
  if (!value.startsWith("var(")) return value;
  const inner = value.slice(4, value.lastIndexOf(")"));
  const target = inner.split(",")[0].trim();
  const fallback = inner.slice(target.length + 1).trim();
  return resolveToken(tokens, target, depth + 1) ?? (fallback.length > 0 ? fallback : null);
}

export function channels(value: string): [number, number, number] | null {
  const hex = value.trim();
  if (hex.startsWith("#")) {
    const digits = hex.slice(1);
    const full = digits.length === 3 ? digits.replace(/./g, d => d + d) : digits;
    if (full.length !== 6) return null;
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
  }
  if (hex.startsWith("rgb")) {
    const parts = hex
      .slice(hex.indexOf("(") + 1)
      .split(",")
      .map(part => Number.parseFloat(part));
    if (parts.length < 3 || parts.some(part => Number.isNaN(part))) return null;
    return [parts[0], parts[1], parts[2]];
  }
  return null;
}

function luminance(rgb: [number, number, number]): number {
  const linear = rgb.map(channel => {
    const ratio = channel / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrast(foreground: string, background: string): number | null {
  const a = channels(foreground);
  const b = channels(background);
  if (!a || !b) return null;
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

export function separation(first: string, second: string): number | null {
  const a = channels(first);
  const b = channels(second);
  if (!a || !b) return null;
  return Math.sqrt(a.reduce((total, value, index) => total + (value - b[index]) ** 2, 0));
}
