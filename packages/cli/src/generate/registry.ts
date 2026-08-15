import type { ProjectDetection } from "../detect";
import type { PlannedWrite } from "../mutation/transaction";
import type { ProcessRunner } from "../process-runner";
import { generateNextApp, undoNextApp } from "./next-generator";
import { planNextWrites } from "./next-plan";
import { generateViteApp, undoViteApp } from "./vite-generator";
import { planViteWrites } from "./vite-plan";

export type GeneratorInput = {
  detection: ProjectDetection;
  publishableKey: string;
  apiUrl: string;
  signal?: AbortSignal;
};

export type ApplicationGeneratorDependencies = {
  runner?: ProcessRunner;
  plan?: (input: GeneratorInput) => Promise<PlannedWrite[]>;
};

export type ApplicationGenerator = (
  input: GeneratorInput,
  dependencies?: ApplicationGeneratorDependencies,
) => Promise<{ files: string[]; route: string }>;

export type ApplicationUndo = (
  detection: ProjectDetection,
  runner?: ProcessRunner,
  signal?: AbortSignal,
) => Promise<{ files: string[]; dependencySyncOk: boolean }>;

export function generatorFor(framework: ProjectDetection["framework"]): {
  plan: (input: GeneratorInput) => Promise<PlannedWrite[]>;
  generate: ApplicationGenerator;
  undo: ApplicationUndo;
} | null {
  if (framework === "next-app") {
    return {
      plan: planNextWrites,
      generate: generateNextApp,
      undo: undoNextApp,
    };
  }
  if (framework === "vite-react") {
    return {
      plan: planViteWrites,
      generate: generateViteApp,
      undo: undoViteApp,
    };
  }
  return null;
}
