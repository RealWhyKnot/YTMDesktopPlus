export function callMethod(target: object, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(target, name);
  if (typeof method !== "function") throw new TypeError(`Missing fixture method: ${name}`);
  return Reflect.apply(method, target, args);
}
