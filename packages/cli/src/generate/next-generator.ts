import type { ProjectDetection } from "../detect";
import { AUTHOWL_NEXT_VERSION, AUTHOWL_REACT_VERSION } from "../metadata";
import type { ProcessRunner } from "../process-runner";
import {
  applyApplicationGenerator,
  GeneratorValidationError,
  undoGeneratedApp,
} from "./application-generator";
import { planNextWrites } from "./next-plan";

const NEXT_VALIDATION_FILES = [
  "tsconfig.json",
  "jsconfig.json",
  "next-env.d.ts",
];

export { GeneratorValidationError };

export type NextGeneratorDependencies = {
  runner?: ProcessRunner;
  plan?: typeof planNextWrites;
};

export async function generateNextApp(
  input: {
    detection: ProjectDetection;
    publishableKey: string;
    apiUrl: string;
    signal?: AbortSignal;
  },
  dependencies: NextGeneratorDependencies = {},
): Promise<{ files: string[]; route: string }> {
  const writes = await (dependencies.plan ?? planNextWrites)(input);
  return applyApplicationGenerator({
    detection: input.detection,
    generatedDirectories: [".next"],
    packages: [
      `@authowl/react@${AUTHOWL_REACT_VERSION}`,
      `@authowl/next@${AUTHOWL_NEXT_VERSION}`,
    ],
    redactions: [input.publishableKey],
    route: `http://localhost:${input.detection.ports[0] ?? 3000}/sign-in`,
    signal: input.signal,
    validationFiles: NEXT_VALIDATION_FILES,
    writes,
    runner: dependencies.runner,
  });
}

export function undoNextApp(
  detection: ProjectDetection,
  runner?: ProcessRunner,
  signal?: AbortSignal,
): Promise<{ files: string[]; dependencySyncOk: boolean }> {
  return undoGeneratedApp(detection, runner, signal);
}
