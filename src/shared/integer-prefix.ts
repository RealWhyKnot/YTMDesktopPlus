export function readDecimalIntegerPrefix(value: string): number {
  const prefix = /^[+-]?\d+/u.exec(value.trimStart());
  return prefix ? Number(prefix[0]) : NaN;
}

export function readIntegerPrefix(value: string): number {
  const trimmed = value.trimStart();
  return /^[+-]?0x/iu.test(trimmed) ? Number.parseInt(trimmed, 16) : readDecimalIntegerPrefix(trimmed);
}
