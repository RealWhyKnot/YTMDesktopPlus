export function requireElement<T extends Element>(value: unknown, constructor: new () => T): T {
  if (!(value instanceof constructor)) throw new TypeError("Unexpected element in the component fixture");
  return value;
}
