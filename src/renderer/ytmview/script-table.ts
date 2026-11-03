export type ScriptTable = Record<string, Record<string, string>>;

export function mergeScript(table: ScriptTable, namespace: string, name: string, script: string): void {
  table[namespace] ??= {};
  table[namespace][name] = script;
}
