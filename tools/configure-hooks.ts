import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function configureHookRunner(file: string): void {
  const source = readFileSync(file, "utf8");
  const current = 'sh -e "$s" "$@"';
  const configured = 'bash -e "$s" "$@"';
  if (source.includes(configured)) return;
  if (!source.includes(current)) throw new Error("Husky's hook command has changed");
  writeFileSync(file, source.replace(current, configured));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url && process.env.HUSKY !== "0") {
  configureHookRunner(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.husky/_/h"));
}
