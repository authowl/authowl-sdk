import { terminalText } from "../terminal";
import type {
  CanonicalImportManifest,
  ImportBatchResponse,
} from "./contracts";

export type ImportRunSummary = {
  mode: "dry_run" | "commit";
  status: "completed";
  source: CanonicalImportManifest["source"];
  counts: {
    total: number;
    valid: number;
    invalid: number;
    created?: number;
    updated?: number;
    unchanged?: number;
    failed?: number;
  };
  bytes_received: number;
  resumed_from_row: number;
  batches: ImportBatchResponse[];
};

export function summarizeImportRun(
  manifest: CanonicalImportManifest,
  batches: ImportBatchResponse[],
  resumedFromRow: number,
  mode: ImportRunSummary["mode"],
): ImportRunSummary {
  const counts = {
    total: sumBatchCount(batches, "total"),
    valid: sumBatchCount(batches, "valid"),
    invalid: sumBatchCount(batches, "invalid"),
    ...(mode === "commit"
      ? {
          created: sumBatchCount(batches, "created"),
          updated: sumBatchCount(batches, "updated"),
          unchanged: sumBatchCount(batches, "unchanged"),
          failed: sumBatchCount(batches, "failed"),
        }
      : {}),
  };
  return {
    mode,
    status: "completed",
    source: manifest.source,
    counts,
    bytes_received: batches.reduce(
      (total, batch) => total + batch.bytes_received,
      0,
    ),
    resumed_from_row: resumedFromRow,
    batches,
  };
}

export function formatImportRun(summary: ImportRunSummary): string {
  const rows = [
    summary.mode === "dry_run"
      ? "Import dry run completed."
      : "User import completed.",
    `Source: ${terminalText(summary.source.provider)}/${terminalText(summary.source.namespace)}`,
    `Batches: ${summary.batches.length}`,
    `Rows: ${summary.counts.total} total, ${summary.counts.valid} valid, ${summary.counts.invalid} invalid`,
  ];
  if (summary.resumed_from_row > 0) {
    rows.push(`Resumed after row: ${summary.resumed_from_row}`);
  }
  if (summary.mode === "commit") {
    rows.push(
      `Writes: ${summary.counts.created ?? 0} created, ${summary.counts.updated ?? 0} updated, ${summary.counts.unchanged ?? 0} unchanged, ${summary.counts.failed ?? 0} failed`,
    );
  }
  const issues = summary.batches.flatMap((batch) =>
    (batch.errors ?? []).map((error) => ({ batchId: batch.id, error })),
  );
  if (issues.length > 0) {
    rows.push(
      "",
      "Validation issues:",
      ...issues.map(({ batchId, error }) => {
        const path = error.path ? ` ${terminalText(error.path)}` : "";
        return `- batch ${terminalText(batchId)}, line ${error.line} [${terminalText(error.code)}]${path}: ${terminalText(error.message)}`;
      }),
    );
    if (summary.batches.some((batch) => batch.errors_truncated)) {
      rows.push("- Additional issues were omitted by the server.");
    }
  }
  return rows.join("\n");
}

function sumBatchCount(
  batches: ImportBatchResponse[],
  field: keyof ImportBatchResponse["counts"],
): number {
  return batches.reduce(
    (total, batch) => total + (batch.counts[field] ?? 0),
    0,
  );
}
