import { lstat, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { PackageManager } from "../detect";
import {
  assertRegularDirectory,
  assertRegularFile,
  assertSafeParentDirectories,
  atomicWrite,
  digest,
  removeEmptyParents,
  safeRelativePath,
} from "./safe-files";
import { parseUndoManifest } from "./undo-manifest";

export const UNDO_DIRECTORY = ".authowl/undo";

export async function undoLastChange(
  root: string,
): Promise<{ packageManager: PackageManager; files: string[] }> {
  const undoRoot = resolve(root, UNDO_DIRECTORY);
  await assertRegularDirectory(undoRoot, "AuthOwl undo directory");
  await assertRegularFile(
    join(undoRoot, "manifest.json"),
    "AuthOwl undo manifest",
  );
  const manifest = parseUndoManifest(
    JSON.parse(await readFile(join(undoRoot, "manifest.json"), "utf8")),
  );
  const current = new Map<string, { content: Buffer; mode: number }>();
  for (const entry of manifest.entries) {
    await assertSafeParentDirectories(root, entry.path);
    const path = resolve(root, safeRelativePath(entry.path));
    await assertRegularFile(path, "generated file");
    const content = await readFile(path);
    if (digest(content) !== entry.afterSha256) {
      throw new Error(
        `Cannot undo because ${entry.path} changed after AuthOwl init`,
      );
    }
    current.set(entry.path, {
      content,
      mode: (await lstat(path)).mode & 0o777,
    });
  }
  const applied: typeof manifest.entries = [];
  try {
    for (const entry of [...manifest.entries].reverse()) {
      const path = resolve(root, entry.path);
      if (entry.kind === "remove") {
        await rm(path, { force: true });
        await removeEmptyParents(root, dirname(path));
      } else if (entry.kind === "backup") {
        const backupPath = join(undoRoot, entry.backup);
        await assertRegularFile(backupPath, "AuthOwl undo backup");
        await atomicWrite(path, await readFile(backupPath), entry.mode);
      } else {
        const before = current
          .get(entry.path)!
          .content.subarray(0, entry.beforeBytes);
        if (digest(before) !== entry.beforeSha256) {
          throw new Error(`Cannot safely restore ${entry.path}`);
        }
        await atomicWrite(path, before, entry.mode);
      }
      applied.push(entry);
    }
  } catch (error) {
    const restoreFailures: unknown[] = [];
    for (const entry of [...applied].reverse()) {
      try {
        const after = current.get(entry.path)!;
        await assertSafeParentDirectories(root, entry.path);
        await atomicWrite(
          resolve(root, safeRelativePath(entry.path)),
          after.content,
          after.mode,
        );
      } catch (restoreError) {
        restoreFailures.push(restoreError);
      }
    }
    throw new AggregateError(
      [error, ...restoreFailures],
      restoreFailures.length > 0
        ? "AuthOwl undo failed and could not restore every generated file"
        : "AuthOwl undo failed before completion; generated files were restored",
    );
  }
  await rm(undoRoot, { recursive: true, force: true });
  await rmdir(dirname(undoRoot)).catch(() => undefined);
  return {
    packageManager: manifest.packageManager,
    files: manifest.entries.map((entry) => entry.path),
  };
}
