import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { compilePageScript } from "../viteconfig/page-scripts.mts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templateDir = path.join(repoRoot, "examples", "addon-template");
export const TEMPLATE_OUTPUT = path.join(repoRoot, ".vite", "addon-template");

export async function buildAddonTemplate(destination = TEMPLATE_OUTPUT): Promise<void> {
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      emptyOutDir: false,
      target: "esnext",
      minify: false,
      lib: { entry: path.join(templateDir, "index.ts"), formats: ["cjs"] },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const entry = outputs.flatMap((output) => ("output" in output ? output.output : [])).find((output) => output.type === "chunk" && output.isEntry);
  if (entry?.type !== "chunk") throw new Error("The addon template build produced no entry point");
  const pagePath = path.join(templateDir, "page.script.ts");
  const page = await compilePageScript(await readFile(pagePath, "utf8"), pagePath);
  await mkdir(destination, { recursive: true });
  await cp(templateDir, destination, { recursive: true });
  await writeFile(path.join(destination, "index.js"), entry.code, "utf8");
  await writeFile(path.join(destination, "page.script.js"), page, "utf8");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildAddonTemplate();
  console.log(TEMPLATE_OUTPUT);
}
