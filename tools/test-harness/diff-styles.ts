import { appendFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { array, record, stringValue } from "./values.ts";

const beforeDirectory = stringValue(process.argv[2]);
const afterDirectory = stringValue(process.argv[3]);
const outputFile = stringValue(process.argv[4]);

function loadSnapshot(directory: string, name: string) {
  const parsed: unknown = JSON.parse(readFileSync(path.join(directory, name), "utf8"));
  const snapshot = record(parsed);
  const variableSets = snapshot.variableSets === undefined ? [] : array(snapshot.variableSets);
  const unpack = (value: unknown) => {
    const packed = record(value);
    if (typeof packed.variableSet !== "number") return packed;
    return { ...record(variableSets[packed.variableSet]), ...record(packed.properties) };
  };
  return {
    snapshot,
    entries: new Map(
      array(snapshot.entries).map((value) => {
        const entry = record(value);
        if (typeof entry.variableSet === "number") {
          entry.properties = unpack(entry);
          entry.pseudo = Object.fromEntries(Object.entries(record(entry.pseudo)).map(([name, pseudo]) => [name, unpack(pseudo)]));
        }
        return [stringValue(entry.key), entry] as const;
      })
    ),
  };
}

writeFileSync(outputFile, '"snapshot","element","property","old","new"\n');
let differenceCount = 0;
let pending = "";
function writeRow(row: string[]) {
  pending += `${row.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")}\n`;
  if (pending.length > 1_000_000) {
    appendFileSync(outputFile, pending);
    pending = "";
  }
}
const counts = new Map<string, number>();
const propertyCounts = new Map<string, number>();
function compare(name: string, key: string, property: string, before: unknown, after: unknown) {
  if (before === after || JSON.stringify(before) === JSON.stringify(after)) return;
  differenceCount++;
  writeRow([name, key, property, before === undefined ? "undefined" : JSON.stringify(before), after === undefined ? "undefined" : JSON.stringify(after)]);
  counts.set(name, (counts.get(name) ?? 0) + 1);
  propertyCounts.set(property, (propertyCounts.get(property) ?? 0) + 1);
}

function compareProperties(name: string, key: string, prefix: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  for (const property of new Set([...Object.keys(before), ...Object.keys(after)]))
    compare(name, key, `${prefix}${property}`, before[property], after[property]);
}

const names = readdirSync(beforeDirectory).filter((name) => /^(settings-tab-|integrations-expanded-|room-|ytm-|loader-).+\.json$/.test(name));
const missing: string[] = [];
if (names.length === 0) throw new Error("No style snapshots were found");
for (const name of names) {
  if (process.argv.includes("--partial") && !existsSync(path.join(afterDirectory, name))) {
    missing.push(name);
    continue;
  }
  const before = loadSnapshot(beforeDirectory, name);
  const after = loadSnapshot(afterDirectory, name);
  compare(name, "document", "viewport", before.snapshot.viewport, after.snapshot.viewport);
  compare(name, "document", "reducedMotion", before.snapshot.reducedMotion, after.snapshot.reducedMotion);
  for (const key of new Set([...before.entries.keys(), ...after.entries.keys()])) {
    const oldEntry = before.entries.get(key);
    const newEntry = after.entries.get(key);
    if (!oldEntry || !newEntry) {
      compare(name, key, "element", oldEntry, newEntry);
      continue;
    }
    compareProperties(name, key, "bounds.", record(oldEntry.bounds), record(newEntry.bounds));
    compareProperties(name, key, "", record(oldEntry.properties), record(newEntry.properties));
    for (const pseudo of ["::before", "::after"]) {
      compareProperties(name, key, `${pseudo}.`, record(record(oldEntry.pseudo)[pseudo]), record(record(newEntry.pseudo)[pseudo]));
    }
  }
}
appendFileSync(outputFile, pending);
const summary = {
  snapshots: names.length - missing.length,
  missing,
  differences: differenceCount,
  counts: Object.fromEntries(counts),
  properties: Object.fromEntries(propertyCounts),
};
writeFileSync(`${outputFile}.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ snapshots: summary.snapshots, differences: summary.differences, counts: summary.counts }));
