import { randomBytes } from "node:crypto";
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
import { resolveApiUrl } from "./api-url";
import { CLI_SCOPES } from "./contract";

export type CliCredential = {
  apiUrl: string;
  accessToken: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
};

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AUTHOWL_CONFIG_HOME)
    return join(env.AUTHOWL_CONFIG_HOME, "credentials.json");
  const base =
    env.XDG_CONFIG_HOME ||
    (process.platform === "win32" && env.APPDATA) ||
    join(homedir(), ".config");
  return join(base, "authowl", "credentials.json");
}

export async function writeCredential(
  credential: CliCredential,
  path = credentialPath(),
): Promise<void> {
  validateCredential(credential);
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch(() => undefined);
  const temporary = join(
    directory,
    `.credentials-${process.pid}-${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(credential, null, 2)}\n`, {
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

export async function readCredential(
  path = credentialPath(),
): Promise<CliCredential | null> {
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
    throw new Error(`AuthOwl credentials are malformed: ${path}`);
  }
  validateCredential(value);
  return value;
}

export async function deleteCredential(
  path = credentialPath(),
): Promise<boolean> {
  try {
    await rm(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

function validateCredential(value: unknown): asserts value is CliCredential {
  if (!value || typeof value !== "object")
    throw new Error("Invalid AuthOwl credential");
  const row = value as Record<string, unknown>;
  if (
    typeof row.apiUrl !== "string" ||
    typeof row.accessToken !== "string" ||
    !/^aoc_[A-Za-z0-9_-]{32,}$/.test(row.accessToken) ||
    !Array.isArray(row.scopes) ||
    row.scopes.length === 0 ||
    !row.scopes.every((scope) => typeof scope === "string") ||
    new Set(row.scopes).size !== row.scopes.length ||
    row.scopes.some(
      (scope) => !CLI_SCOPES.includes(scope as (typeof CLI_SCOPES)[number]),
    ) ||
    typeof row.createdAt !== "string" ||
    !isIsoDate(row.createdAt) ||
    typeof row.expiresAt !== "string" ||
    !isIsoDate(row.expiresAt)
  ) {
    throw new Error("Invalid AuthOwl credential");
  }
  resolveApiUrl(row.apiUrl);
}

function isIsoDate(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
