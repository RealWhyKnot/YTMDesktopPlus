export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("Expected an object");
  return value;
}

export function stringValue(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected text");
  return value;
}

export function numberValue(value: unknown): number {
  if (typeof value !== "number") throw new Error("Expected a number");
  return value;
}

export function array(value: unknown): unknown[] {
  if (!isArray(value)) throw new Error("Expected an array");
  return value;
}

export function optionalRecord(value: unknown): Record<string, unknown> | null | undefined {
  return value === null || value === undefined ? value : record(value);
}

export function defined<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected a value");
  return value;
}
