import { powerMonitor } from "electron";

export function onSystemResume(listener: () => void): () => void {
  powerMonitor.on("resume", listener);
  return () => {
    powerMonitor.removeListener("resume", listener);
  };
}
