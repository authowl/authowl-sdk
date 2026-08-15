import { classifyProject } from "./classify";
import { collectProjectSnapshot } from "./collect";
import type { ProjectDetection } from "./types";

export async function detectProject(
  directory = process.cwd(),
  options: { includeGit?: boolean } = {},
): Promise<ProjectDetection> {
  return classifyProject(await collectProjectSnapshot(directory, options));
}

export { classifyProject, collectProjectSnapshot };
export type {
  Framework,
  PackageManager,
  ProjectDetection,
  ProjectSnapshot,
} from "./types";
