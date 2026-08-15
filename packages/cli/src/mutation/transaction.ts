import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { PackageManager } from "../detect";
import { appendPatch, fullFilePatch } from "./patch";
import {
  assertSafeParentDirectories,
  atomicWrite,
  digest,
  ensureDirectory,
  isNodeError,
  optionalRegularBuffer,
  pathExists,
  removeEmptyParents,
  safeRelativePath,
} from "./safe-files";
import type { UndoEntry, UndoManifest } from "./undo-manifest";
import { UNDO_DIRECTORY } from "./undo";

export { undoLastChange } from "./undo";

type Snapshot = {
  relativePath: string;
  content: Buffer | null;
  mode: number | null;
  sensitiveAppend: boolean;
};

export type PlannedWrite = {
  relativePath: string;
  content: string;
  mode?: number;
  sensitiveAppend?: boolean;
};

export class FileTransaction {
  private readonly snapshots = new Map<string, Snapshot>();

  constructor(readonly root: string) {}

  async capture(relativePath: string, sensitiveAppend = false): Promise<void> {
    const normalized = safeRelativePath(relativePath);
    const existing = this.snapshots.get(normalized);
    if (existing) {
      if (sensitiveAppend) existing.sensitiveAppend = true;
      return;
    }
    await assertSafeParentDirectories(this.root, normalized);
    const path = this.path(normalized);
    try {
      const metadata = await lstat(path);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`Refusing to modify non-regular file: ${normalized}`);
      }
      this.snapshots.set(normalized, {
        relativePath: normalized,
        content: await readFile(path),
        mode: metadata.mode & 0o777,
        sensitiveAppend,
      });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this.snapshots.set(normalized, {
          relativePath: normalized,
          content: null,
          mode: null,
          sensitiveAppend,
        });
        return;
      }
      throw error;
    }
  }

  async write(change: PlannedWrite): Promise<void> {
    await this.capture(change.relativePath, change.sensitiveAppend);
    const snapshot = this.snapshots.get(safeRelativePath(change.relativePath))!;
    if (snapshot.sensitiveAppend && snapshot.content) {
      const next = Buffer.from(change.content, "utf8");
      if (!next.subarray(0, snapshot.content.length).equals(snapshot.content)) {
        throw new Error(
          `Sensitive file changes must be append-only: ${change.relativePath}`,
        );
      }
    }
    await atomicWrite(
      this.path(change.relativePath),
      Buffer.from(change.content, "utf8"),
      change.mode ?? snapshot.mode ?? 0o644,
    );
  }

  async rollback(): Promise<void> {
    const failures: unknown[] = [];
    for (const snapshot of [...this.snapshots.values()].reverse()) {
      try {
        await assertSafeParentDirectories(this.root, snapshot.relativePath);
        const path = this.path(snapshot.relativePath);
        if (snapshot.content === null) {
          await rm(path, { force: true });
          await removeEmptyParents(this.root, dirname(path));
        } else {
          await atomicWrite(path, snapshot.content, snapshot.mode ?? 0o644);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        "AuthOwl could not restore every setup file",
      );
    }
  }

  async persistUndo(
    packageManager: PackageManager,
    now = new Date(),
  ): Promise<void> {
    const authOwlRoot = this.path(".authowl");
    const undoRoot = this.path(UNDO_DIRECTORY);
    const nonce = `${process.pid}-${randomBytes(8).toString("hex")}`;
    const nextUndoRoot = join(authOwlRoot, `.undo-next-${nonce}`);
    const previousUndoRoot = join(authOwlRoot, `.undo-previous-${nonce}`);
    await ensureDirectory(authOwlRoot, 0o700);
    await mkdir(join(nextUndoRoot, "files"), {
      recursive: true,
      mode: 0o700,
    });
    const entries: UndoEntry[] = [];
    let backupIndex = 0;
    for (const snapshot of this.snapshots.values()) {
      await assertSafeParentDirectories(this.root, snapshot.relativePath);
      const current = await optionalRegularBuffer(
        this.path(snapshot.relativePath),
        "generated file",
      );
      if (current === null && snapshot.content === null) continue;
      if (current === null)
        throw new Error(`Generated file disappeared: ${snapshot.relativePath}`);
      if (snapshot.content?.equals(current)) continue;
      const afterSha256 = digest(current);
      if (snapshot.content === null) {
        entries.push({
          kind: "remove",
          path: snapshot.relativePath,
          afterSha256,
        });
        continue;
      }
      if (snapshot.sensitiveAppend) {
        if (
          !current.subarray(0, snapshot.content.length).equals(snapshot.content)
        ) {
          throw new Error(
            `Sensitive file was not appended safely: ${snapshot.relativePath}`,
          );
        }
        entries.push({
          kind: "truncate",
          path: snapshot.relativePath,
          beforeBytes: snapshot.content.length,
          beforeSha256: digest(snapshot.content),
          afterSha256,
          mode: snapshot.mode ?? 0o600,
        });
        continue;
      }
      const backup = `files/${backupIndex.toString().padStart(4, "0")}`;
      backupIndex += 1;
      await writeFile(join(nextUndoRoot, backup), snapshot.content, {
        mode: 0o600,
        flag: "wx",
      });
      entries.push({
        kind: "backup",
        path: snapshot.relativePath,
        backup,
        mode: snapshot.mode ?? 0o644,
        afterSha256,
      });
    }
    const manifest: UndoManifest = {
      version: 1,
      packageManager,
      createdAt: now.toISOString(),
      entries,
    };
    try {
      await atomicWrite(
        join(nextUndoRoot, "manifest.json"),
        Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`),
        0o600,
      );
      await chmod(authOwlRoot, 0o700).catch(() => undefined);
      await chmod(nextUndoRoot, 0o700).catch(() => undefined);
      const hadPrevious = await pathExists(undoRoot);
      if (hadPrevious) await rename(undoRoot, previousUndoRoot);
      try {
        await rename(nextUndoRoot, undoRoot);
      } catch (error) {
        if (hadPrevious) await rename(previousUndoRoot, undoRoot);
        throw error;
      }
      await rm(previousUndoRoot, { recursive: true, force: true });
    } catch (error) {
      await rm(nextUndoRoot, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw error;
    }
  }

  patchFor(changes: PlannedWrite[]): string {
    const sections: string[] = [];
    for (const change of changes) {
      const snapshot = this.snapshots.get(
        safeRelativePath(change.relativePath),
      );
      if (!snapshot) continue;
      const next = Buffer.from(change.content, "utf8");
      if (snapshot.content?.equals(next)) continue;
      if (snapshot.sensitiveAppend && snapshot.content) {
        const appended = next
          .subarray(snapshot.content.length)
          .toString("utf8");
        sections.push(
          appendPatch(
            change.relativePath,
            snapshot.content.toString("utf8"),
            appended,
          ),
        );
      } else {
        sections.push(
          fullFilePatch(
            change.relativePath,
            snapshot.content?.toString("utf8") ?? "",
            change.content,
          ),
        );
      }
    }
    return sections.join("\n");
  }

  private path(relativePath: string): string {
    const path = resolve(this.root, safeRelativePath(relativePath));
    if (
      relative(this.root, path).startsWith("..") ||
      isAbsolute(relative(this.root, path))
    ) {
      throw new Error("Generated path escapes the application root");
    }
    return path;
  }
}
