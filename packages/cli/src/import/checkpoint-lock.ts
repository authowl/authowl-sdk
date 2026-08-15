import { randomBytes } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";

type ImportCheckpointLock = {
  pid: number;
  token: string;
};

export async function acquireImportCheckpointLock(
  path: string,
): Promise<() => Promise<void>> {
  const lock: ImportCheckpointLock = {
    pid: process.pid,
    token: randomBytes(16).toString("hex"),
  };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(path, "wx", 0o600);
      let writeError: unknown;
      let writeFailed = false;
      try {
        await handle.writeFile(`${JSON.stringify(lock)}\n`, "utf8");
      } catch (error) {
        writeFailed = true;
        writeError = error;
      } finally {
        await handle.close();
      }
      if (writeFailed) {
        await rm(path, { force: true }).catch(() => undefined);
        throw writeError;
      }
      return () => releaseImportCheckpointLock(path, lock.token);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") throw error;
      const existing = await readLock(path);
      if (existing && processExists(existing.pid)) {
        throw new Error(
          "Another AuthOwl import is already using this source and destination.",
        );
      }
      await rm(path, { force: true });
    }
  }
  throw new Error(
    "Another AuthOwl import acquired this source and destination.",
  );
}

async function releaseImportCheckpointLock(
  path: string,
  token: string,
): Promise<void> {
  const current = await readLock(path);
  if (current?.token === token) {
    await rm(path, { force: true });
  }
}

async function readLock(path: string): Promise<ImportCheckpointLock | null> {
  let serialized: string;
  try {
    serialized = await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return null;
    throw error;
  }
  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    if (
      Number.isSafeInteger(value.pid) &&
      (value.pid as number) > 0 &&
      typeof value.token === "string" &&
      /^[a-f0-9]{32}$/.test(value.token)
    ) {
      return { pid: value.pid as number, token: value.token };
    }
  } catch {
    return null;
  }
  return null;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
