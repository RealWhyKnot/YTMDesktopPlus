import { type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { stringValue, record } from "./values.ts";

export function validate<T extends TSchema>(schema: T, value: unknown): Static<T> {
  if (!Value.Check(schema, value)) throw new Error("Unexpected harness response");
  return value;
}

export function parseJson(value: unknown): unknown {
  return JSON.parse(stringValue(value));
}

export function parseObject(value: unknown): Record<string, unknown> {
  return record(parseJson(value));
}
