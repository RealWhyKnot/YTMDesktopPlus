// Emits examples/addon-template/ytmd-addon.d.ts from src/shared/addons/sdk.ts.
// The app compiles against sdk.ts directly; the emitted file is the copy addon
// authors drop next to their own code. Regenerate with: yarn sdk:dts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SDK_SOURCE_PATH = path.join(repoRoot, "src", "shared", "addons", "sdk.ts");
export const OUTPUT_PATH = path.join(repoRoot, "examples", "addon-template", "ytmd-addon.d.ts");

const HEADER = [
  "// Type declarations for YTMDesktopPlus addons.",
  "// Generated from src/shared/addons/sdk.ts - do not edit by hand.",
  "// Regenerate with: yarn sdk:dts",
  "",
  ""
].join("\n");

export function generateAddonDts() {
  const program = ts.createProgram([SDK_SOURCE_PATH], {
    declaration: true,
    emitDeclarationOnly: true,
    strict: true,
    skipLibCheck: true
  });

  const diagnostics = ts.getPreEmitDiagnostics(program);
  if (diagnostics.length > 0) {
    const formatted = diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n");
    throw new Error(`sdk.ts does not compile standalone:\n${formatted}`);
  }

  let declarations = null;
  program.emit(
    undefined,
    (fileName, text) => {
      if (fileName.endsWith(".d.ts")) declarations = text;
    },
    undefined,
    true
  );
  if (declarations === null) throw new Error("No declaration output produced for sdk.ts");

  return HEADER + declarations.replace(/\r\n/g, "\n");
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  const text = generateAddonDts();
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, text);
  console.log(`Wrote ${path.relative(repoRoot, OUTPUT_PATH)}`);
}
