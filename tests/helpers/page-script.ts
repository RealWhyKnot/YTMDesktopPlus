import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";
import { compilePageScript } from "../../viteconfig/page-scripts.mts";

export async function readPageScript(file: string): Promise<string> {
  const source = readFileSync(file, "utf8");
  return await compilePageScript(source, file);
}

export function evaluatePageScript(source: string): unknown {
  return runInThisContext(`(${source.replace(/;$/, "")})`);
}

export function runPageScript(source: string, ...args: unknown[]): unknown {
  const script = evaluatePageScript(source);
  if (typeof script !== "function") throw new TypeError("Expected a callable page script");
  return Reflect.apply(script, undefined, args);
}
