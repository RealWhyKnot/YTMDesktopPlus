export type ScriptTable = { [namespace: string]: { [scriptName: string]: string } };

/** Adds one script to the table in place; a later registration under the same
 *  name replaces the source, so re-merging is idempotent. */
export function mergeScript(table: ScriptTable, namespace: string, name: string, script: string): void {
  if (!table[namespace]) table[namespace] = {};
  table[namespace][name] = script;
}
