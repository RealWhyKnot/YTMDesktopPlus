import { statSync, openSync, readSync, closeSync, existsSync } from "node:fs";

import type { Emit } from "./events.ts";

export function createLogTail({
  files,
  emit,
  matchers = [],
  tripwires = [],
  onTrip,
}: {
  files: () => string[];
  emit: Emit;
  matchers?: RegExp[];
  tripwires?: { name: string; pattern: RegExp }[];
  onTrip?: (name: string, line: string) => void;
}) {
  const offsets = new Map<string, number>();
  const timer = setInterval(() => {
    for (const file of files()) {
      try {
        if (!existsSync(file)) continue;
        const size = statSync(file).size;
        const offset = offsets.get(file) ?? 0;
        if (size <= offset) {
          if (size < offset) offsets.set(file, 0);
          continue;
        }
        const fd = openSync(file, "r");
        const buffer = Buffer.alloc(size - offset);
        readSync(fd, buffer, 0, buffer.length, offset);
        closeSync(fd);
        offsets.set(file, size);
        for (const line of buffer.toString("utf8").split(/\r?\n/)) {
          if (!line) continue;
          for (const tripwire of tripwires) {
            if (tripwire.pattern.test(line)) {
              emit("log-tripwire", { name: tripwire.name, line: line.slice(0, 300) });
              onTrip?.(tripwire.name, line);
            }
          }
          for (const matcher of matchers) {
            if (matcher.test(line)) {
              emit("app-log", { line: line.slice(0, 300) });
              break;
            }
          }
        }
      } catch (error) {
        console.warn("log-tail: operation failed", error);
      }
    }
  }, 500);
  return { stop: () => clearInterval(timer) };
}

export function grepFile(file: string, pattern: RegExp) {
  try {
    if (!existsSync(file)) return null;
    const fd = openSync(file, "r");
    const size = statSync(file).size;
    const buffer = Buffer.alloc(size);
    readSync(fd, buffer, 0, size, 0);
    closeSync(fd);
    return (
      buffer
        .toString("utf8")
        .split(/\r?\n/)
        .find((line) => pattern.test(line)) ?? null
    );
  } catch {
    return null;
  }
}
