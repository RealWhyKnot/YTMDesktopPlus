import type { HarnessContext } from "./run.ts";
import { isRecord, isArray } from "./values.ts";

type Scenario = {
  runScenario: (context: HarnessContext) => unknown;
  needsCompanion?: boolean;
  inspectMain?: boolean;
  expectedTripwires?: string[];
  fixture?: Record<string, unknown>;
  env?: NodeJS.ProcessEnv;
  prepareProfile?: (directory: string) => unknown;
};

function isScenario(value: unknown): value is Scenario {
  return (
    isRecord(value) &&
    typeof value.runScenario === "function" &&
    (value.needsCompanion === undefined || typeof value.needsCompanion === "boolean") &&
    (value.inspectMain === undefined || typeof value.inspectMain === "boolean") &&
    (value.expectedTripwires === undefined || (isArray(value.expectedTripwires) && value.expectedTripwires.every((item) => typeof item === "string"))) &&
    (value.fixture === undefined || isRecord(value.fixture)) &&
    (value.env === undefined || (isRecord(value.env) && Object.values(value.env).every((item) => item === undefined || typeof item === "string"))) &&
    (value.prepareProfile === undefined || typeof value.prepareProfile === "function")
  );
}

export function readScenario(value: unknown): Scenario {
  if (!isScenario(value)) throw new Error("Invalid harness scenario");
  return value;
}
