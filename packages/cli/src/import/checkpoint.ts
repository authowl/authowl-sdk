import { createHash, randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  ImportBatchResponse,
  ImportProvider,
} from "./contracts";
import { parseImportBatchResponse } from "./response-contract";
import { acquireImportCheckpointLock } from "./checkpoint-lock";
import {
  fingerprintImportSource,
  type ImportSourceFingerprint,
} from "./source-fingerprint";

export type { ImportSourceFingerprint } from "./source-fingerprint";

export type ImportCheckpointIdentity = {
  dryRun: boolean;
  filePath: string;
  projectId: string;
  provider: ImportProvider;
  sourceNamespace: string;
  sourceVersion: string;
};

export type ImportCheckpoint = {
  version: 1;
  identity: ImportCheckpointIdentity;
  fingerprint: ImportSourceFingerprint;
  nextRow: number;
  batches: ImportBatchResponse[];
  updatedAt: string;
};

export type ImportCheckpointStore = {
  acquire(identity: ImportCheckpointIdentity): Promise<() => Promise<void>>;
  fingerprint(filePath: string): Promise<ImportSourceFingerprint>;
  load(identity: ImportCheckpointIdentity): Promise<ImportCheckpoint | null>;
  remove(identity: ImportCheckpointIdentity): Promise<void>;
  save(checkpoint: ImportCheckpoint): Promise<void>;
};

export function createImportCheckpointStore(
  env: NodeJS.ProcessEnv = process.env,
): ImportCheckpointStore {
  return {
    acquire: (identity) => acquireCheckpoint(identity, env),
    fingerprint: fingerprintImportSource,
    load: (identity) => readImportCheckpoint(identity, env),
    remove: (identity) => deleteImportCheckpoint(identity, env),
    save: (checkpoint) => writeImportCheckpoint(checkpoint, env),
  };
}

async function acquireCheckpoint(
  identity: ImportCheckpointIdentity,
  env: NodeJS.ProcessEnv,
): Promise<() => Promise<void>> {
  const path = importCheckpointLockPath(identity, env);
  await ensurePrivateDirectory(dirname(path));
  return acquireImportCheckpointLock(path);
}

function importCheckpointLockPath(
  identity: ImportCheckpointIdentity,
  env: NodeJS.ProcessEnv,
): string {
  return importCheckpointPath(identity, env).replace(/\.json$/, ".lock");
}

async function readImportCheckpoint(
  identity: ImportCheckpointIdentity,
  env: NodeJS.ProcessEnv,
): Promise<ImportCheckpoint | null> {
  const path = importCheckpointPath(identity, env);
  let serialized: string;
  try {
    serialized = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error(`AuthOwl import checkpoint is malformed: ${path}`);
  }
  return parseCheckpoint(value, identity);
}

async function writeImportCheckpoint(
  checkpoint: ImportCheckpoint,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  parseCheckpoint(checkpoint, checkpoint.identity);
  const path = importCheckpointPath(checkpoint.identity, env);
  const directory = dirname(path);
  await ensurePrivateDirectory(directory);
  const temporary = join(
    directory,
    `.import-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
    await chmod(path, 0o600).catch(() => undefined);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function ensurePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
}

async function deleteImportCheckpoint(
  identity: ImportCheckpointIdentity,
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await rm(importCheckpointPath(identity, env), { force: true });
}

function importCheckpointPath(
  identity: ImportCheckpointIdentity,
  env: NodeJS.ProcessEnv,
): string {
  const digest = createHash("sha256")
    .update(JSON.stringify(identity))
    .digest("hex")
    .slice(0, 32);
  return join(configHome(env), "imports", `${digest}.json`);
}

function configHome(env: NodeJS.ProcessEnv): string {
  if (env.AUTHOWL_CONFIG_HOME) return env.AUTHOWL_CONFIG_HOME;
  const base =
    env.XDG_CONFIG_HOME ||
    (process.platform === "win32" && env.APPDATA) ||
    join(homedir(), ".config");
  return join(base, "authowl");
}

function parseCheckpoint(
  value: unknown,
  identity: ImportCheckpointIdentity,
): ImportCheckpoint {
  if (!isRecord(value)) throw new Error("Invalid AuthOwl import checkpoint");
  if (
    value.version !== 1 ||
    !sameIdentity(value.identity, identity) ||
    !validFingerprint(value.fingerprint) ||
    !Number.isSafeInteger(value.nextRow) ||
    (value.nextRow as number) < 0 ||
    !Array.isArray(value.batches) ||
    typeof value.updatedAt !== "string" ||
    !validIsoDate(value.updatedAt)
  ) {
    throw new Error("Invalid AuthOwl import checkpoint");
  }
  let batches: ImportBatchResponse[];
  try {
    batches = value.batches.map(parseImportBatchResponse);
  } catch {
    throw new Error("Invalid AuthOwl import checkpoint");
  }
  const expectedMode = identity.dryRun ? "dry_run" : "commit";
  if (
    batches.some(
      (batch) =>
        batch.mode !== expectedMode ||
        batch.source.provider !== identity.provider ||
        batch.source.namespace !== identity.sourceNamespace ||
        batch.source.version !== identity.sourceVersion,
    ) ||
    batches.reduce((total, batch) => total + batch.counts.total, 0) !==
      value.nextRow
  ) {
    throw new Error("Invalid AuthOwl import checkpoint");
  }
  return {
    version: 1,
    identity,
    fingerprint: value.fingerprint,
    nextRow: value.nextRow as number,
    batches,
    updatedAt: value.updatedAt,
  };
}

function sameIdentity(
  value: unknown,
  expected: ImportCheckpointIdentity,
): boolean {
  if (!isRecord(value)) return false;
  return (
    value.dryRun === expected.dryRun &&
    value.filePath === expected.filePath &&
    value.projectId === expected.projectId &&
    value.provider === expected.provider &&
    value.sourceNamespace === expected.sourceNamespace &&
    value.sourceVersion === expected.sourceVersion
  );
}

function validFingerprint(
  value: unknown,
): value is ImportSourceFingerprint {
  return (
    isRecord(value) &&
    Number.isSafeInteger(value.bytes) &&
    (value.bytes as number) >= 0 &&
    typeof value.modifiedAtMs === "number" &&
    Number.isFinite(value.modifiedAtMs) &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256)
  );
}

function validIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
