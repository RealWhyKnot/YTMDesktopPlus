import { appendFileSync } from "node:fs";

export type Emit = (event: string, data?: Record<string, unknown>) => void;

export function createEmitter(jsonlPath: string, startedAt: number) {
  let lastEvent = "start";
  const emit: Emit = (event, data = {}) => {
    lastEvent = event;
    const line = JSON.stringify({ t: Number(((Date.now() - startedAt) / 1000).toFixed(1)), event, ...data });
    console.log(line);
    try {
      appendFileSync(jsonlPath, line + "\n");
    } catch (error) {
      console.warn("events: operation failed", error);
    }
  };
  return { emit, lastEvent: () => lastEvent };
}
