import type { PackageManager } from "../detect";
import { safeRelativePath } from "./safe-files";

export type UndoEntry =
  | { kind: "remove"; path: string; afterSha256: string }
  | {
      kind: "backup";
      path: string;
      backup: string;
      mode: number;
      afterSha256: string;
    }
  | {
      kind: "truncate";
      path: string;
      beforeBytes: number;
      beforeSha256: string;
      afterSha256: string;
      mode: number;
    };

export type UndoManifest = {
  version: 1;
  packageManager: PackageManager;
  createdAt: string;
  entries: UndoEntry[];
};

export function parseUndoManifest(value: unknown): UndoManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid AuthOwl undo manifest");
  }
  const row = value as Partial<UndoManifest>;
  if (
    row.version !== 1 ||
    !["npm", "pnpm", "yarn", "bun"].includes(String(row.packageManager)) ||
    !Array.isArray(row.entries) ||
    row.entries.some((entry) => !validUndoEntry(entry))
  ) {
    throw new Error("Invalid AuthOwl undo manifest");
  }
  return row as UndoManifest;
}

function validUndoEntry(value: unknown): value is UndoEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.path === "string" &&
    safeRelativePath(row.path) === row.path &&
    typeof row.afterSha256 === "string" &&
    /^[a-f0-9]{64}$/.test(row.afterSha256) &&
    (row.kind === "remove" ||
      (row.kind === "backup" &&
        typeof row.backup === "string" &&
        /^files\/\d{4}$/.test(row.backup) &&
        validMode(row.mode)) ||
      (row.kind === "truncate" &&
        typeof row.beforeBytes === "number" &&
        Number.isSafeInteger(row.beforeBytes) &&
        row.beforeBytes >= 0 &&
        typeof row.beforeSha256 === "string" &&
        /^[a-f0-9]{64}$/.test(row.beforeSha256) &&
        validMode(row.mode)))
  );
}

function validMode(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0o777
  );
}
