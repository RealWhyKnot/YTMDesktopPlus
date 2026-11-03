import { isRecord } from "../../src/shared/unknown";

export function requireValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error("Expected a value in the test fixture");
  return value;
}

export function requireRecord(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError("Expected an object in the test fixture");
  return value;
}

export function requireStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((entry: unknown) => typeof entry === "string")) throw new TypeError("Expected strings in the test fixture");
  return value;
}
