import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getRawHeader } from "@electron/asar";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mb = bytes => Math.round((bytes / 1048576) * 100) / 100;
const toPosix = value => value.split(path.sep).join("/");

function walk(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, base, out);
    else out.push({ file: toPosix(path.relative(base, full)), size: statSync(full).size });
  }
  return out;
}

function walkAsarHeader(node, prefix, out) {
  for (const [name, value] of Object.entries(node.files ?? {})) {
    const full = prefix ? `${prefix}/${name}` : name;
    if (value.files) walkAsarHeader(value, full, out);
    else out.push({ file: full, size: value.size ?? 0 });
  }
  return out;
}

function packageOf(file) {
  const parts = file.split("/");
  const index = parts.lastIndexOf("node_modules");
  if (index === -1 || index + 1 >= parts.length) return "(app code)";
  const first = parts[index + 1];
  if (first.startsWith("@") && index + 2 < parts.length) return `${first}/${parts[index + 2]}`;
  return first;
}

function groupPackages(files) {
  const byPackage = new Map();
  for (const entry of files) {
    const key = packageOf(entry.file);
    byPackage.set(key, (byPackage.get(key) ?? 0) + entry.size);
  }
  return [...byPackage.entries()].sort((a, b) => b[1] - a[1]).map(([name, size]) => ({ name, sizeMb: mb(size) }));
}

function findAsar() {
  const outDir = path.join(REPO_ROOT, "out");
  if (!existsSync(outDir)) return null;
  const stack = [outDir];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isFile() && entry.name === "app.asar") return full;
      if (entry.isDirectory()) stack.push(full);
    }
  }
  return null;
}

const viteFiles = walk(path.join(REPO_ROOT, ".vite")).sort((a, b) => b.size - a.size);
const report = {
  measuredAt: new Date().toISOString(),
  vite: {
    totalMb: mb(viteFiles.reduce((sum, file) => sum + file.size, 0)),
    fileCount: viteFiles.length,
    largest: viteFiles.slice(0, 12).map(file => ({ file: file.file, sizeMb: mb(file.size) }))
  },
  asar: null
};

const asarPath = findAsar();
if (asarPath) {
  const asarFiles = walkAsarHeader(getRawHeader(asarPath).header, "", []).sort((a, b) => b.size - a.size);
  report.asar = {
    path: toPosix(path.relative(REPO_ROOT, asarPath)),
    onDiskMb: mb(statSync(asarPath).size),
    unpackedMb: mb(asarFiles.reduce((sum, file) => sum + file.size, 0)),
    fileCount: asarFiles.length,
    largest: asarFiles.slice(0, 12).map(file => ({ file: file.file, sizeMb: mb(file.size) })),
    byPackage: groupPackages(asarFiles).slice(0, 25)
  };
}

const outPath = process.argv[2] ?? path.join(REPO_ROOT, "tools", "test-harness", "runs", "build-metrics.json");
writeFileSync(outPath, JSON.stringify(report, null, 2));

console.log(`.vite  ${report.vite.totalMb} MB across ${report.vite.fileCount} files`);
for (const file of report.vite.largest.slice(0, 6)) console.log(`       ${String(file.sizeMb).padStart(8)} MB  ${file.file}`);
if (report.asar) {
  console.log(`asar   ${report.asar.onDiskMb} MB on disk, ${report.asar.unpackedMb} MB unpacked, ${report.asar.fileCount} files (${report.asar.path})`);
  for (const pkg of report.asar.byPackage.slice(0, 15)) console.log(`       ${String(pkg.sizeMb).padStart(8)} MB  ${pkg.name}`);
} else {
  console.log("asar   not found under out/; run `yarn package` or `yarn make` first");
}
console.log(`report written to ${toPosix(path.relative(REPO_ROOT, outPath))}`);
