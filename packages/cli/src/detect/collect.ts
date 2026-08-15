import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { promisify } from "node:util";
import type { ProjectSnapshot } from "./types";

const execFileAsync = promisify(execFile);

const LOCKFILE_PATHS = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

const PROBED_PATHS = [
  "tsconfig.json",
  "app",
  "pages",
  "src/app",
  "src/pages",
  "src/main.tsx",
  "src/main.jsx",
  "src/main.ts",
  "src/main.js",
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
] as const;

const CONFIG_PATHS = [
  "vite.config.ts",
  "vite.config.js",
  "vite.config.mts",
  "vite.config.mjs",
] as const;

export async function collectProjectSnapshot(
  startDirectory = process.cwd(),
  options: { includeGit?: boolean } = {},
): Promise<ProjectSnapshot> {
  const root = await findProjectRoot(startDirectory);
  const serialized = await readFile(join(root, "package.json"), "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error(
      `package.json is not valid JSON: ${join(root, "package.json")}`,
    );
  }
  const packageJson = validatePackageJson(parsed, join(root, "package.json"));

  const existingPaths = new Set<string>();
  await Promise.all(
    PROBED_PATHS.map(async (path) => {
      if (await exists(join(root, path))) existingPaths.add(path);
    }),
  );
  const configSources: Record<string, string> = {};
  await Promise.all(
    CONFIG_PATHS.map(async (path) => {
      if (!existingPaths.has(path)) return;
      configSources[path] = await readFile(join(root, path), "utf8");
    }),
  );

  return {
    root,
    packageJson,
    packageManagerContext: await collectPackageManagerContext(root),
    existingPaths,
    configSources,
    dirtyWorktree: options.includeGit === false ? null : await gitDirty(root),
  };
}

async function collectPackageManagerContext(
  applicationRoot: string,
): Promise<ProjectSnapshot["packageManagerContext"]> {
  let current = applicationRoot;
  const filesystemRoot = parse(current).root;
  while (true) {
    const lockfileCandidates = await Promise.all(
      LOCKFILE_PATHS.map(async (path) =>
        (await exists(join(current, path))) ? path : null,
      ),
    );
    const lockfiles = lockfileCandidates.filter(
      (path): path is (typeof LOCKFILE_PATHS)[number] => path !== null,
    );
    let declared: string | undefined;
    try {
      const manifest = JSON.parse(
        await readFile(join(current, "package.json"), "utf8"),
      ) as {
        packageManager?: unknown;
      };
      if (
        typeof manifest.packageManager === "string" &&
        /^(?:npm|pnpm|yarn|bun)@/.test(manifest.packageManager)
      ) {
        declared = manifest.packageManager;
      }
    } catch {
      // The application manifest is validated separately. Missing or malformed
      // ancestor manifests are not package-manager evidence.
    }
    if (declared || lockfiles.length > 0)
      return { root: current, declared, lockfiles };
    if (current === filesystemRoot) break;
    current = dirname(current);
  }
  return { root: null, declared: undefined, lockfiles: [] };
}

function validatePackageJson(
  value: unknown,
  path: string,
): ProjectSnapshot["packageJson"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`package.json must contain an object: ${path}`);
  }
  const manifest = value as Record<string, unknown>;
  return {
    dependencies: stringRecord(manifest.dependencies, "dependencies", path),
    devDependencies: stringRecord(
      manifest.devDependencies,
      "devDependencies",
      path,
    ),
    scripts: stringRecord(manifest.scripts, "scripts", path),
  };
}

function stringRecord(
  value: unknown,
  field: string,
  path: string,
): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`package.json ${field} must contain an object: ${path}`);
  }
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== "string")) {
    throw new Error(`package.json ${field} values must be strings: ${path}`);
  }
  return Object.fromEntries(entries) as Record<string, string>;
}

export async function findProjectRoot(startDirectory: string): Promise<string> {
  let current = resolve(startDirectory);
  const filesystemRoot = parse(current).root;
  while (true) {
    if (await exists(join(current, "package.json"))) return current;
    if (current === filesystemRoot) break;
    current = dirname(current);
  }
  throw new Error(`No package.json found from ${startDirectory}`);
}

async function gitDirty(root: string): Promise<boolean | null> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["status", "--porcelain=v1", "--untracked-files=normal"],
      { cwd: root, encoding: "utf8", maxBuffer: 1024 * 1024 },
    );
    return stdout.trim().length > 0;
  } catch {
    return null;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
