import { appendFileSync } from "node:fs";

// Every event is one JSON line on stdout, mirrored to the run's jsonl file,
// so a live tail and the archived run show the same stream.
export function createEmitter(jsonlPath, startedAt) {
  let lastEvent = "start";
  const emit = (event, data = {}) => {
    lastEvent = event;
    const line = JSON.stringify({ t: Number(((Date.now() - startedAt) / 1000).toFixed(1)), event, ...data });
    console.log(line);
    try {
      appendFileSync(jsonlPath, line + "\n");
    } catch {
      // The stream to stdout is the primary channel; never die over the mirror.
    }
  };
  return { emit, lastEvent: () => lastEvent };
}
