import { describe, expect, it } from "vitest";
import { selectStrays } from "../tools/test-harness/teardown.mjs";

const RUNS = "C:\\src\\ytmd\\tools\\test-harness\\runs\\";
const OTHER_RUNS = "C:\\src\\ytmd-wt\\tools\\test-harness\\runs\\";
const ELECTRON = '"C:\\src\\ytmd\\node_modules\\electron\\dist\\electron.exe"';
const profile = (runs: string) => `${runs}2026-09-28T10-10-37-boot-hooks\\profile`;

const harnessRun = (runs: string, checkout: string, firstPid: number) => [
  {
    ProcessId: firstPid,
    Name: "node.exe",
    CommandLine: `"C:\\nodejs\\node.exe" ${checkout}\\node_modules\\@electron-forge\\cli\\dist\\electron-forge-start.js -- --disable-features=CalculateNativeWinOcclusion --user-data-dir=${profile(runs)}`
  },
  {
    ProcessId: firstPid + 1,
    Name: "electron.exe",
    CommandLine: `${ELECTRON} . --disable-features=CalculateNativeWinOcclusion --user-data-dir=${profile(runs)}`
  },
  {
    ProcessId: firstPid + 2,
    Name: "electron.exe",
    CommandLine: `${ELECTRON} --type=renderer --user-data-dir="${profile(runs)}" --app-path="${checkout}" /prefetch:1`
  },
  { ProcessId: firstPid + 3, Name: "electron.exe", CommandLine: `${ELECTRON} --type=crashpad-handler --user-data-dir=${profile(runs)} /prefetch:4` }
];

const pids = (rows: { ProcessId: number }[]) => rows.map(row => row.ProcessId);

describe("harness sweep scope", () => {
  it("selects forge, the app and its children for runs in this checkout", () => {
    expect(pids(selectStrays(harnessRun(RUNS, "C:\\src\\ytmd", 100), RUNS))).toEqual([100, 101, 102, 103]);
  });

  it("leaves another checkout's run alone although it shares the electron binary", () => {
    expect(selectStrays(harnessRun(OTHER_RUNS, "C:\\src\\ytmd-wt", 200), RUNS)).toEqual([]);
  });

  it("leaves dev instances, the runner and unrelated processes alone", () => {
    const rows = [
      { ProcessId: 300, Name: "electron.exe", CommandLine: `${ELECTRON} .` },
      { ProcessId: 301, Name: "electron.exe", CommandLine: `${ELECTRON} --type=renderer --user-data-dir=C:\\Users\\me\\AppData\\Roaming\\YTMDesktopPlus-dev` },
      { ProcessId: 302, Name: "node.exe", CommandLine: "node .yarn/releases/yarn-4.18.0.cjs start" },
      { ProcessId: 303, Name: "node.exe", CommandLine: "node tools/test-harness/run.mjs boot-hooks" },
      { ProcessId: 304, Name: "node.exe", CommandLine: `node inspect.mjs ${profile(RUNS)}` },
      { ProcessId: 305, Name: "powershell.exe", CommandLine: `powershell -Command "Get-Content ${profile(RUNS)}\\logs\\main.log"` },
      { ProcessId: 306, Name: "System", CommandLine: null }
    ];
    expect(selectStrays(rows, RUNS)).toEqual([]);
  });

  it("matches the checkout path and process names regardless of case", () => {
    const rows = [{ ProcessId: 400, Name: "Electron.exe", CommandLine: `${ELECTRON} --type=gpu-process --user-data-dir=${profile(RUNS).toLowerCase()}` }];
    expect(pids(selectStrays(rows, RUNS.toUpperCase()))).toEqual([400]);
  });
});
