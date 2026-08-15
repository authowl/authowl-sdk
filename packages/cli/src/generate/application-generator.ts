import { lstat, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import type { ProjectDetection } from "../detect";
import {
  FileTransaction,
  type PlannedWrite,
  undoLastChange,
} from "../mutation/transaction";
import {
  runProcess,
  type ProcessResult,
  type ProcessRunner,
} from "../process-runner";
import {
  formatCommand,
  frozenSyncCommand,
  installExactCommand,
  type PackageCommand,
} from "./package-manager";

const LOCKFILES = [
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
] as const;

export class GeneratorValidationError extends Error {
  constructor(
    message: string,
    readonly patch: string,
    readonly diagnostics: string,
  ) {
    super(message);
    this.name = "GeneratorValidationError";
  }
}

export async function applyApplicationGenerator(input: {
  detection: ProjectDetection;
  generatedDirectories: string[];
  packages: string[];
  redactions: string[];
  route: string;
  signal?: AbortSignal;
  validationFiles: string[];
  writes: PlannedWrite[];
  runner?: ProcessRunner;
}): Promise<{ files: string[]; route: string }> {
  const { detection } = input;
  if (detection.packageManager === "unknown" || !detection.packageManagerRoot) {
    throw new Error("Choose one package manager before running AuthOwl init");
  }
  const transactionRoot = detection.packageManagerRoot;
  const applicationPrefix = relative(
    transactionRoot,
    detection.root,
  ).replaceAll("\\", "/");
  if (applicationPrefix.startsWith("..")) {
    throw new Error("The package-manager root must contain the application");
  }
  const prefix = (path: string) =>
    applicationPrefix ? `${applicationPrefix}/${path}` : path;
  const transaction = new FileTransaction(transactionRoot);
  const runner = input.runner ?? runProcess;
  const generatedDirectories = await Promise.all(
    input.generatedDirectories.map(async (path) => ({
      path: join(detection.root, path),
      existed: await pathExists(join(detection.root, path)),
    })),
  );
  const applicationManifest = parseManifest(
    JSON.parse(await readFile(join(detection.root, "package.json"), "utf8")),
  );
  const writes = input.writes.map((change) => ({
    ...change,
    relativePath: prefix(change.relativePath),
  }));
  const gitignore = await optionalText(join(transactionRoot, ".gitignore"));
  if (!gitignore.split(/\r?\n/).includes(".authowl/")) {
    writes.push({
      relativePath: ".gitignore",
      content: `${gitignore}${gitignore && !gitignore.endsWith("\n") ? "\n" : ""}.authowl/\n`,
    });
  }

  await transaction.capture(prefix("package.json"));
  for (const path of input.validationFiles) {
    await transaction.capture(prefix(path));
  }
  for (const lockfile of LOCKFILES) {
    await transaction.capture(lockfile);
    if (applicationPrefix) await transaction.capture(prefix(lockfile));
  }

  try {
    for (const write of writes) await transaction.write(write);
    await checked(
      runner,
      installExactCommand(detection.packageManager, input.packages),
      detection.root,
      "dependency installation",
      input.signal,
    );
    const sourceFiles = input.writes
      .map((write) => write.relativePath)
      .filter((path) => /\.(?:js|jsx|ts|tsx)$/.test(path));
    if (
      hasDependency(applicationManifest, "prettier") &&
      sourceFiles.length > 0
    ) {
      await checked(
        runner,
        formatCommand(detection.packageManager, sourceFiles),
        detection.root,
        "formatting",
        input.signal,
      );
    }
    for (const script of ["typecheck", "build"] as const) {
      if (applicationManifest.scripts?.[script]) {
        await checked(
          runner,
          { command: detection.packageManager, args: ["run", script] },
          detection.root,
          script,
          input.signal,
        );
      }
    }
    await transaction.persistUndo(detection.packageManager);
    return {
      files: writes.map((write) => write.relativePath),
      route: input.route,
    };
  } catch (error) {
    const patch = redact(transaction.patchFor(writes), input.redactions);
    const rollbackFailures: unknown[] = [];
    try {
      await transaction.rollback();
    } catch (rollbackError) {
      rollbackFailures.push(rollbackError);
    }
    for (const directory of generatedDirectories) {
      if (directory.existed) continue;
      try {
        await rm(directory.path, { recursive: true, force: true });
      } catch (rollbackError) {
        rollbackFailures.push(rollbackError);
      }
    }
    const validationDetails =
      error instanceof CommandError
        ? redact(
            `${error.result.stdout}\n${error.result.stderr}`,
            input.redactions,
          ).trim()
        : error instanceof Error
          ? error.message
          : "Unknown generator failure";
    const rollbackDetails = rollbackFailures
      .map((failure) =>
        failure instanceof Error ? failure.message : "Unknown rollback failure",
      )
      .join("\n");
    throw new GeneratorValidationError(
      rollbackFailures.length === 0
        ? "AuthOwl setup failed validation and setup files were restored"
        : "AuthOwl setup failed validation and automatic rollback was incomplete",
      patch,
      [validationDetails, rollbackDetails].filter(Boolean).join("\n"),
    );
  }
}

export async function undoGeneratedApp(
  detection: ProjectDetection,
  runner: ProcessRunner = runProcess,
  signal?: AbortSignal,
): Promise<{ files: string[]; dependencySyncOk: boolean }> {
  if (detection.packageManager === "unknown" || !detection.packageManagerRoot) {
    throw new Error("Cannot determine the package manager for undo");
  }
  const undone = await undoLastChange(detection.packageManagerRoot);
  const result = await runner(
    ...runnerArgs(
      frozenSyncCommand(undone.packageManager),
      detection.root,
      signal,
    ),
  );
  return { files: undone.files, dependencySyncOk: result.code === 0 };
}

class CommandError extends Error {
  constructor(
    phase: string,
    readonly result: ProcessResult,
  ) {
    super(`${phase} failed`);
    this.name = "CommandError";
  }
}

async function checked(
  runner: ProcessRunner,
  invocation: PackageCommand,
  cwd: string,
  phase: string,
  signal?: AbortSignal,
): Promise<void> {
  const result = await runner(...runnerArgs(invocation, cwd, signal));
  if (result.code !== 0) throw new CommandError(phase, result);
}

function runnerArgs(
  invocation: PackageCommand,
  cwd: string,
  signal?: AbortSignal,
): [string, string[], { cwd: string; signal?: AbortSignal }] {
  return [
    invocation.command,
    invocation.args,
    { cwd, ...(signal ? { signal } : {}) },
  ];
}

function parseManifest(value: unknown): {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("package.json must contain an object");
  }
  return value as ReturnType<typeof parseManifest>;
}

function hasDependency(
  manifest: ReturnType<typeof parseManifest>,
  name: string,
): boolean {
  return Boolean(
    manifest.dependencies?.[name] || manifest.devDependencies?.[name],
  );
}

function redact(value: string, redactions: string[]): string {
  return redactions.reduce(
    (result, secret) =>
      secret ? result.replaceAll(secret, "[publishable-key]") : result,
    value,
  );
}

async function optionalText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}
