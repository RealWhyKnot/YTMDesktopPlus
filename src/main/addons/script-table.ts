export function serializeYtmScripts(table: ReadonlyMap<string, ReadonlyMap<string, string>>): Record<string, Record<string, string>> {
  return Object.fromEntries(Array.from(table, ([namespace, scripts]) => [namespace, Object.assign({}, Object.fromEntries(scripts))] as const));
}
