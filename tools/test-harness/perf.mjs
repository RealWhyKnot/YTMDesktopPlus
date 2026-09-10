import { execFileSync } from "node:child_process";

const ps = script => {
  try {
    return execFileSync("powershell", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 64 * 1024 * 1024
    });
  } catch {
    return "";
  }
};

const PROCESS_QUERY =
  `Get-CimInstance Win32_Process -Filter "Name='electron.exe' OR Name='node.exe'" ` +
  `| Select-Object ProcessId,ParentProcessId,Name,WorkingSetSize,CommandLine ` +
  `| ConvertTo-Json -Compress -Depth 2`;

function readProcesses() {
  const out = ps(PROCESS_QUERY);
  if (!out.trim()) return [];
  try {
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function treeFrom(rootPid, rows) {
  const byParent = new Map();
  for (const row of rows) {
    const siblings = byParent.get(row.ParentProcessId) ?? [];
    siblings.push(row);
    byParent.set(row.ParentProcessId, siblings);
  }
  const collected = rows.filter(row => row.ProcessId === rootPid);
  const seen = new Set([rootPid]);
  const queue = [rootPid];
  while (queue.length) {
    for (const child of byParent.get(queue.shift()) ?? []) {
      if (seen.has(child.ProcessId)) continue;
      seen.add(child.ProcessId);
      collected.push(child);
      queue.push(child.ProcessId);
    }
  }
  return collected;
}

function classify(row) {
  if (row.Name === "node.exe") return "tooling";
  const type = /--type=([\w-]+)/.exec(row.CommandLine ?? "")?.[1];
  if (!type) return "browser";
  if (type === "gpu-process") return "gpu";
  return type;
}

export function sampleTree(rootPid) {
  const processes = treeFrom(rootPid, readProcesses()).map(row => ({
    pid: row.ProcessId,
    type: classify(row),
    rss: Number(row.WorkingSetSize) || 0
  }));

  const byType = {};
  let app = 0;
  let tooling = 0;
  for (const proc of processes) {
    byType[proc.type] = (byType[proc.type] ?? 0) + proc.rss;
    if (proc.type === "tooling") tooling += proc.rss;
    else app += proc.rss;
  }

  return { count: processes.length, appRss: app, toolingRss: tooling, byType, processes };
}

export function slope(samples, pick) {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const minutes = (last.at - first.at) / 60;
  if (minutes <= 0) return 0;
  return Math.round((pick(last) - pick(first)) / minutes);
}
