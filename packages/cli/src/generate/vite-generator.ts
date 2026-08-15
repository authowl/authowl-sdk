import type { ProjectDetection } from "../detect";
import { AUTHOWL_REACT_VERSION } from "../metadata";
import type { ProcessRunner } from "../process-runner";
import {
  applyApplicationGenerator,
  GeneratorValidationError,
  undoGeneratedApp,
} from "./application-generator";
import { planViteWrites } from "./vite-plan";

const VITE_VALIDATION_FILES = [
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
];

export { GeneratorValidationError };

export type ViteGeneratorDependencies = {
  runner?: ProcessRunner;
  plan?: typeof planViteWrites;
};

export async function generateViteApp(
  input: {
    detection: ProjectDetection;
    publishableKey: string;
    apiUrl: string;
    signal?: AbortSignal;
  },
  dependencies: ViteGeneratorDependencies = {},
): Promise<{ files: string[]; route: string }> {
  const writes = await (dependencies.plan ?? planViteWrites)(input);
  return applyApplicationGenerator({
    detection: input.detection,
    generatedDirectories: ["dist"],
    packages: [`@authowl/react@${AUTHOWL_REACT_VERSION}`],
    redactions: [input.publishableKey],
    route: `http://localhost:${input.detection.ports[0] ?? 5173}/sign-in`,
    signal: input.signal,
    validationFiles: VITE_VALIDATION_FILES,
    writes,
    runner: dependencies.runner,
  });
}

export function undoViteApp(
  detection: ProjectDetection,
  runner?: ProcessRunner,
  signal?: AbortSignal,
): Promise<{ files: string[]; dependencySyncOk: boolean }> {
  return undoGeneratedApp(detection, runner, signal);
}
