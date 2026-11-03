import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const fixture = `
import type { AddonActivate, AddonContext, AddonInstance } from "SDK_PATH";

declare function register(activate: AddonActivate): void;
declare function registerInstance(instance: AddonInstance): void;
declare const context: AddonContext;
declare function record(context: AddonContext): void;

register((context) => { record(context); });
function activate(context: AddonContext) { record(context); }
register(activate);
async function activateAsync(context: AddonContext) { await Promise.resolve(record(context)); }
register(activateAsync);
register((context) => ({ destroy() { record(context); } }));
register(async (context) => ({ destroy: async () => { await Promise.resolve(record(context)); } }));
function maybeActivate(context: AddonContext): AddonInstance | void {
  if (context.manifest.id.length > 0) return { destroy() { record(context); } };
}
register(maybeActivate);
async function maybeActivateAsync(context: AddonContext): Promise<AddonInstance | void> {
  await Promise.resolve();
  if (context.manifest.id.length > 0) return { destroy() { record(context); } };
}
register(maybeActivateAsync);
registerInstance({ destroy: () => { record(context); } });
function destroy() { record(context); }
registerInstance({ destroy });
async function destroyAsync() { await Promise.resolve(record(context)); }
registerInstance({ destroy: destroyAsync });
function maybeDestroy(): void | Promise<void> { if (context.manifest.id.length > 0) return Promise.resolve(); }
registerInstance({ destroy: maybeDestroy });
`;

describe("addon SDK callback compatibility", () => {
  it.each(["../src/shared/addons/sdk", "../examples/addon-template/ytmd-addon"])("compiles existing callback styles against %s", (sdkPath) => {
    const file = path.resolve("tests/addon-callback-fixture.ts");
    const source = fixture.replace("SDK_PATH", sdkPath);
    const options: ts.CompilerOptions = {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.Preserve,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
      path.resolve(name) === file
        ? ts.createSourceFile(file, source, languageVersion, true)
        : originalGetSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
    const diagnostics = ts.getPreEmitDiagnostics(ts.createProgram([file], options, host));
    expect(diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))).toEqual([]);
  });
});
