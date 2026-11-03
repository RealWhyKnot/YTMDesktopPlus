import fs from "fs";
import type { ExternalAddonScan } from "./external-loader";

type DevReloadLog = {
  info(...params: unknown[]): void;
  warn(...params: unknown[]): void;
};

export function watchExternalAddonsForDev(scans: ExternalAddonScan[], reload: (id: string) => Promise<void>, log: DevReloadLog): () => void {
  const watchers: fs.FSWatcher[] = [];
  const timers = new Map<string, NodeJS.Timeout>();
  const inFlight = new Set<string>();

  const reloadAddon = async (id: string) => {
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
  };

  for (const scan of scans) {
    const id = scan.manifest?.id ?? scan.folderName;
    try {
      const watcher = fs.watch(scan.dir, { recursive: true }, () => {
        clearTimeout(timers.get(id));
        timers.set(
          id,
          setTimeout(() => {
            void reloadAddon(id).catch((error: unknown) => log.warn(`Addon reload failed: ${id}`, error));
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
