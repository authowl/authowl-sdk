import type { ImportBatchResponse } from "./contracts";
import { isRecord } from "./source-reader";

export function parseImportBatchResponse(value: unknown): ImportBatchResponse {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.mode !== "dry_run" && value.mode !== "commit") ||
    typeof value.status !== "string" ||
    typeof value.schema_version !== "string" ||
    !isRecord(value.source) ||
    typeof value.source.provider !== "string" ||
    typeof value.source.namespace !== "string" ||
    !nullableString(value.source.version) ||
    !isRecord(value.counts) ||
    !numberField(value.counts.total) ||
    !numberField(value.counts.valid) ||
    !numberField(value.counts.invalid) ||
    !numberField(value.bytes_received) ||
    typeof value.errors_truncated !== "boolean" ||
    typeof value.created_at !== "string" ||
    !nullableString(value.completed_at)
  ) {
    throw new Error("AuthOwl returned an invalid import response.");
  }
  const created = optionalCount(value.counts.created);
  const updated = optionalCount(value.counts.updated);
  const unchanged = optionalCount(value.counts.unchanged);
  const failed = optionalCount(value.counts.failed);
  const errors = parseErrors(value.errors);
  const reportExpiresAt = optionalNullableString(value.report_expires_at);
  return {
    id: value.id,
    mode: value.mode,
    status: value.status,
    schema_version: value.schema_version,
    source: {
      provider: value.source.provider,
      namespace: value.source.namespace,
      version: value.source.version,
    },
    counts: {
      total: value.counts.total,
      valid: value.counts.valid,
      invalid: value.counts.invalid,
      ...(created === undefined ? {} : { created }),
      ...(updated === undefined ? {} : { updated }),
      ...(unchanged === undefined ? {} : { unchanged }),
      ...(failed === undefined ? {} : { failed }),
    },
    bytes_received: value.bytes_received,
    errors_truncated: value.errors_truncated,
    ...(errors === undefined ? {} : { errors }),
    ...(reportExpiresAt === undefined
      ? {}
      : { report_expires_at: reportExpiresAt }),
    created_at: value.created_at,
    completed_at: value.completed_at,
  };
}

function numberField(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function optionalCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!numberField(value)) {
    throw new Error("AuthOwl returned an invalid import response.");
  }
  return value;
}

function parseErrors(
  value: unknown,
): ImportBatchResponse["errors"] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) {
    throw new Error("AuthOwl returned an invalid import response.");
  }
  return value.map((error) => {
    if (
      !isRecord(error) ||
      !numberField(error.line) ||
      typeof error.code !== "string" ||
      !nullableString(error.path) ||
      typeof error.message !== "string"
    ) {
      throw new Error("AuthOwl returned an invalid import response.");
    }
    return {
      line: error.line,
      code: error.code,
      path: error.path,
      message: error.message,
    };
  });
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function optionalNullableString(
  value: unknown,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (!nullableString(value)) {
    throw new Error("AuthOwl returned an invalid import response.");
  }
  return value;
}
