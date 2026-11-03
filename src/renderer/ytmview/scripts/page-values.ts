function isPageRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function pageRecord(value: unknown): Record<string, unknown> | undefined {
  return isPageRecord(value) ? value : undefined;
}

export function pageMember(value: unknown, ...keys: (string | number)[]): unknown {
  for (const key of keys) value = pageRecord(value)?.[key];
  return value;
}

export function pageArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function pageCall(target: unknown, name: string, ...args: unknown[]): unknown {
  const method = pageMember(target, name);
  if (typeof method !== "function") throw new Error(`Missing page method: ${name}`);
  const result: unknown = Reflect.apply(method, target, args);
  return result;
}

export function optionalPageCall(target: unknown, name: string, ...args: unknown[]): unknown {
  return typeof pageMember(target, name) === "function" ? pageCall(target, name, ...args) : undefined;
}
