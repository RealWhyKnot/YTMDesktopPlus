import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, transformWithEsbuild, type Plugin } from "vite";

export async function compilePageScript(source: string, file: string): Promise<string> {
  if (file.endsWith(".script.ts")) {
    const result = await build({
      configFile: false,
      logLevel: "silent",
      build: {
        write: false,
        emptyOutDir: false,
        target: "esnext",
        minify: false,
        lib: { entry: resolve(file), name: "pageScript", formats: ["iife"] },
      },
    });
    const outputs = Array.isArray(result) ? result : [result];
    for (const output of outputs) {
      if (!("output" in output)) continue;
      const chunk = output.output.find((entry) => entry.type === "chunk" && entry.isEntry);
      if (chunk?.type === "chunk") return `(function () { ${chunk.code}\nreturn pageScript.runScript; })()`;
    }
    throw new Error(`No compiled page script for ${file}`);
  }
  const result = await transformWithEsbuild(source, file, { loader: "ts", target: "esnext" });
  return result.code.trim();
}

export function pageScripts(): Plugin {
  return {
    name: "typed-page-scripts",
    enforce: "pre",
    async load(id) {
      if (!/\.(script|worklet)\.ts\?raw$/.test(id)) return null;
      const file = id.slice(0, -4);
      const source = await readFile(file, "utf8");
      return `export default ${JSON.stringify(await compilePageScript(source, file))};`;
    },
  };
}
