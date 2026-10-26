import MemoryStore from "../../memory-store";
import { MemoryStoreSchema } from "~shared/store/schema";

export const AUTH_WINDOW_DURATION_MS = 300 * 1000;

export function watchCompanionAuthWindow(
  memoryStore: MemoryStore<MemoryStoreSchema>,
  isServerEnabled: () => boolean,
  durationMs = AUTH_WINDOW_DURATION_MS
): () => void {
  let timeout: NodeJS.Timeout | null = null;

  const clear = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };

  const listener = (key: string, value: unknown) => {
    if (key !== "companionServerAuthWindowEnabled") return;

    if (!value) {
      clear();
      return;
    }

    if (!isServerEnabled()) {
      memoryStore.set("companionServerAuthWindowEnabled", false);
      return;
    }

    if (!timeout) {
      timeout = setTimeout(() => {
        timeout = null;
        memoryStore.set("companionServerAuthWindowEnabled", false);
      }, durationMs);
    }
  };

  memoryStore.onStateChanged(listener);
  return () => {
    clear();
    memoryStore.removeOnStateChanged(listener);
  };
}
