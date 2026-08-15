import { access, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function firstExisting(
  root: string,
  candidates: string[],
): Promise<string | null> {
  for (const candidate of candidates) {
    try {
      await access(join(root, candidate));
      return candidate;
    } catch {
      // Continue through recognized candidates only.
    }
  }
  return null;
}

export async function existingPaths(
  root: string,
  candidates: string[],
): Promise<string[]> {
  const matches = await Promise.all(
    candidates.map(async (candidate) => {
      try {
        await access(join(root, candidate));
        return candidate;
      } catch {
        return null;
      }
    }),
  );
  return matches.filter((path): path is string => path !== null);
}

export async function readOptionalText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export function appendEnvironment(
  before: string,
  values: Array<[name: string, value: string]>,
): string {
  const separator =
    before.length === 0 ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const lines = values.map(([name, value]) => `${name}=${value}`).join("\n");
  return `${before}${separator}# AuthOwl\n${lines}\n`;
}
