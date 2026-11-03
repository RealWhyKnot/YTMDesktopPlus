#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const DISTRO = process.env.YTMD_DECK_DISTRO?.length ? process.env.YTMD_DECK_DISTRO : "archlinux";
const APP_ID = "dev.whyknot.YTMDesktopPlus";
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");

type WslOptions = { user?: string; capture?: boolean };
function wsl(args: string[], options: WslOptions & { capture: true }): string;
function wsl(args: string[], options?: WslOptions & { capture?: false }): number;
function wsl(args: string[], { user = "deck", capture = false }: WslOptions = {}) {
  const result = spawnSync("wsl.exe", ["-d", DISTRO, "--user", user, "--", ...args], {
    stdio: capture ? "pipe" : "inherit",
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (capture) return (result.stdout || "").replace(/\r/g, "").trim();
  return result.status ?? 1;
}

function toWslPath(windowsPath: string) {
  const translated = wsl(["wslpath", "-a", windowsPath.replaceAll("\\", "/")], { capture: true });
  if (!translated) throw new Error(`Could not translate ${windowsPath} to a WSL path`);
  return translated;
}

function distroExists() {
  const listed = spawnSync("wsl.exe", ["--list", "--quiet"], { encoding: "utf16le" });
  return (listed.stdout || "").split(/\r?\n/).some((line) => line.trim() === DISTRO);
}

function requireProvisioned() {
  if (!distroExists()) {
    throw new Error(`WSL distro "${DISTRO}" is not installed. Run: wsl --install archlinux --no-launch`);
  }
  if (wsl(["sh", "-c", "test -f /var/lib/ytmdplus-provisioned && echo yes"], { capture: true }) !== "yes") {
    throw new Error(`Distro "${DISTRO}" is not provisioned. Run: node tools/steamdeck/run.ts setup`);
  }
}

function newestLocalBundle() {
  const root = path.join(REPO_ROOT, "out", "make", "flatpak");
  if (!existsSync(root)) return null;

  const bundles = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((entry) => path.join(root, entry))
    .filter((entry) => entry.endsWith(".flatpak"));
  if (bundles.length === 0) return null;

  return bundles.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

function originRepo() {
  const url = spawnSync("git", ["remote", "get-url", "origin"], { cwd: REPO_ROOT, encoding: "utf8" });
  const match = /github\.com[:/](.+?)(?:\.git)?\s*$/.exec(url.stdout || "");
  if (!match?.[1]) throw new Error("Could not read the origin remote to resolve the release repo");
  return match[1];
}

function downloadRelease(tag: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "ytmdplus-deck-"));
  const result = spawnSync("gh", ["release", "download", tag, "--repo", originRepo(), "--pattern", "*.flatpak", "--dir", dir], {
    cwd: REPO_ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) throw new Error(`gh release download ${tag} failed`);

  const bundle = readdirSync(dir).find((name) => name.endsWith(".flatpak"));
  if (!bundle) throw new Error(`Release ${tag} has no .flatpak asset`);
  return path.join(dir, bundle);
}

function setup() {
  if (!distroExists()) {
    throw new Error(`WSL distro "${DISTRO}" is not installed. Run: wsl --install archlinux --no-launch`);
  }
  const script = toWslPath(path.join(REPO_ROOT, "tools", "steamdeck", "provision.sh"));
  return wsl(["sh", script], { user: "root" });
}

type RunOptions = { bundle?: string; tag?: string; passthrough: string[] };
function run(options: RunOptions) {
  requireProvisioned();

  let bundle: string | null | undefined = options.bundle;
  if (!bundle && options.tag) bundle = downloadRelease(options.tag);
  if (bundle === "" || bundle === undefined) bundle = newestLocalBundle();
  if (!bundle) {
    throw new Error("No .flatpak found. Pass --tag <release>, pass --bundle <path>, or run the build command first.");
  }

  console.log(`==> Installing ${path.basename(bundle)}`);
  const installed = wsl(["flatpak", "install", "--user", "--noninteractive", "--reinstall", toWslPath(path.resolve(bundle))]);
  if (installed !== 0) return installed;

  console.log(`==> Launching ${APP_ID}`);
  return wsl(["flatpak", "run", APP_ID, ...options.passthrough]);
}

function build() {
  requireProvisioned();

  const script = toWslPath(path.join(REPO_ROOT, "tools", "steamdeck", "build.sh"));
  const status = wsl(["sh", script, toWslPath(REPO_ROOT)]);
  if (status !== 0) return status;

  console.log("==> Built. Install and launch it with: node tools/steamdeck/run.ts run");
  return 0;
}

function parseArgs(argv: string[]) {
  const options: RunOptions = { passthrough: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tag") options.tag = argv[++i];
    else if (argv[i] === "--bundle") options.bundle = argv[++i];
    else if (argv[i] === "--") options.passthrough = argv.slice(i + 1);
  }
  return options;
}

const [command, ...rest] = process.argv.slice(2);
const options = parseArgs(rest);

function executeCommand() {
  switch (command) {
    case "setup":
      return setup();
    case "run":
      return run(options);
    case "build":
      return build();
    case "shell":
      return wsl(["bash", "-l"]);
    case undefined:
    default:
      console.log("Usage: node tools/steamdeck/run.ts <setup|run|build|shell>");
      console.log("  setup                 provision the WSL distro");
      console.log("  run --tag <release>   install that release's flatpak and launch it");
      console.log("  run --bundle <path>   install a local .flatpak and launch it");
      console.log("  run                   use the newest bundle in out/make/flatpak");
      console.log("  build                 build the flatpak inside the distro");
      console.log("  shell                 open a shell in the distro");
      return command ? 1 : 0;
  }
}

try {
  process.exit(executeCommand());
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
