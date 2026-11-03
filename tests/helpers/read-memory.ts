import { memoryGuards } from "../../src/shared/store/validate-memory";
import type { GuardMap } from "../../src/shared/validation";

function createMemoryReader<T extends Record<string, unknown>>(guards: GuardMap<T>) {
  return <K extends keyof T>(memory: ReadonlyMap<string, unknown>, key: K): T[K] => {
    const value = memory.get(String(key));
    if (!guards[key](value)) throw new TypeError(`Invalid ${String(key)} in the memory fixture`);
    return value;
  };
}

export const readMemory = createMemoryReader(memoryGuards);
