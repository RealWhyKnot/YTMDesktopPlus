import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import { format, resolveConfig } from "prettier";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SDK_SOURCE_PATH = path.join(repoRoot, "src", "shared", "addons", "sdk.ts");
export const OUTPUT_PATH = path.join(repoRoot, "examples", "addon-template", "ytmd-addon.d.ts");

export async function generateAddonDts() {
  const program = ts.createProgram([SDK_SOURCE_PATH], {
    declaration: true,
    emitDeclarationOnly: true,
    removeComments: true,
    strict: true,
    skipLibCheck: true,
    types: [],
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    const formatted = diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n");
    throw new Error(`sdk.ts does not compile standalone:\n${formatted}`);
  }

  let declarations = "";
  program.emit(
    undefined,
    (fileName, text) => {
      if (fileName.endsWith(".d.ts")) declarations = text;
    },
    undefined,
    true
  );
  if (declarations === "") throw new Error("No declaration output produced for sdk.ts");

  const options = await resolveConfig(OUTPUT_PATH);
  return format(declarations, { ...options, filepath: OUTPUT_PATH });
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const text = await generateAddonDts();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, text);
  console.log(`Wrote ${path.relative(repoRoot, OUTPUT_PATH)}`);
}
