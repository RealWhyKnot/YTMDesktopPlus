import { isRecord } from "./unknown";

export type Guard<T> = (value: unknown) => value is T;
export type GuardMap<T> = { [K in keyof T]-?: Guard<T[K]> };

export const isString: Guard<string> = (value): value is string => typeof value === "string";
export const isNumber: Guard<number> = (value): value is number => typeof value === "number";
export const isBoolean: Guard<boolean> = (value): value is boolean => typeof value === "boolean";
export const isUndefined: Guard<undefined> = (value): value is undefined => value === undefined;

export function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value);
}

export function nullable<T>(guard: Guard<T>): Guard<T | null> {
  return (value): value is T | null => value === null || guard(value);
}

export function arrayOf<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

export function recordOf<T>(guard: Guard<T>): Guard<Record<string, T>> {
  return (value): value is Record<string, T> => isRecord(value) && Object.values(value).every(guard);
}

export function objectOf<T extends Record<string, unknown>>(fields: GuardMap<T>): Guard<T> {
  return (value): value is T => {
    if (!isRecord(value)) return false;
    for (const key in fields) {
      if (Object.hasOwn(fields, key) && !fields[key](value[key])) return false;
    }
    return true;
  };
}

export function partialObjectOf<T extends Record<string, unknown>>(fields: GuardMap<T>): Guard<Partial<T>> {
  return (value): value is Partial<T> => {
    if (!isRecord(value)) return false;
    for (const key in fields) {
      if (Object.hasOwn(fields, key) && value[key] !== undefined && !fields[key](value[key])) return false;
    }
    return true;
  };
}
