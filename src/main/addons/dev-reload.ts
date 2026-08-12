import fs from "fs";
import type { ExternalAddonScan } from "./external-loader";

type DevReloadLog = {
  info(...params: unknown[]): void;
  warn(...params: unknown[]): void;
};

/** Watches every valid external addon folder and reloads the addon after its
 *  files change. Development only: the user-facing enable and disable model
 *  stays restart-scoped. Returns a stop function. */
export function watchExternalAddonsForDev(scans: ExternalAddonScan[], reload: (id: string) => Promise<void>, log: DevReloadLog): () => void {
  const watchers: fs.FSWatcher[] = [];
  const timers = new Map<string, NodeJS.Timeout>();
  const inFlight = new Set<string>();

  for (const scan of scans) {
    if (!scan.manifest || scan.error) continue;
    const id = scan.manifest.id;
    try {
      // 500ms of quiet absorbs editors that fire several events per save.
      const watcher = fs.watch(scan.dir, { recursive: true }, () => {
        clearTimeout(timers.get(id));
        timers.set(
          id,
          setTimeout(async () => {
            if (inFlight.has(id)) return;
            inFlight.add(id);
            try {
              log.info(`Reloading addon after a file change: ${id}`);
              await reload(id);
            } catch (error) {
              log.warn(`Addon reload failed: ${id}`, error);
            } finally {
              inFlight.delete(id);
            }
          }, 500)
        );
      });
      watchers.push(watcher);
    } catch (error) {
      log.warn(`Could not watch addon folder: ${scan.dir}`, error);
    }
  }

  return () => {
    for (const timer of timers.values()) clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}
