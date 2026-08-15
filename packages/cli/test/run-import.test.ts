import { describe, expect, it, vi } from "vitest";
import { runImport } from "../src/import/run-import";
import type {
  ImportCheckpoint,
  ImportCheckpointStore,
} from "../src/import/checkpoint";
import type { ImportBatchResponse } from "../src/import/contracts";

const projectId = "11111111-1111-4111-8111-111111111111";
const secretKey = `sk_test_${projectId}_${"S".repeat(32)}`;

describe("import command orchestration", () => {
  it("selects the provider adapter and formats dry-run findings", async () => {
    const adaptClerk = vi.fn(() => records());
    const upload = vi.fn(async () => ({
      id: "33333333-3333-4333-8333-333333333333",
      mode: "dry_run" as const,
      status: "validated",
      schema_version: "authowl.user-import.v1",
      source: {
        provider: "clerk",
        namespace: "ins_synthetic",
        version: "dashboard-export-2026-07",
      },
      counts: { total: 2, valid: 1, invalid: 1 },
      bytes_received: 420,
      errors_truncated: false,
      errors: [
        {
          line: 3,
          code: "INVALID_USER",
          path: "password.scheme",
          message: "Unsupported password scheme.",
        },
      ],
      created_at: "2026-07-16T10:00:00.000Z",
      completed_at: "2026-07-16T10:00:00.000Z",
    }));

    const output = await runImport(
      {
        dryRun: true,
        filePath: "./synthetic.csv",
        from: "clerk",
        projectId,
        sourceNamespace: "ins_synthetic",
      },
      {
        adapters: { clerk: adaptClerk },
        env: {
          AUTHOWL_API_URL: "http://localhost:3010",
          AUTHOWL_SECRET_KEY: secretKey,
        },
        checkpoints: memoryCheckpoints(),
        upload,
      },
    );

    expect(adaptClerk).toHaveBeenCalledWith(
      expect.stringMatching(/synthetic\.csv$/),
      expect.objectContaining({
        provider: "clerk",
        sourceNamespace: "ins_synthetic",
      }),
    );
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({
        apiUrl: "http://localhost:3010",
        dryRun: true,
        projectId,
        secretKey,
        manifest: {
          type: "manifest",
          schema_version: "authowl.user-import.v1",
          source: {
            provider: "clerk",
            namespace: "ins_synthetic",
            version: "dashboard-export-2026-07",
          },
        },
      }),
      expect.anything(),
    );
    expect(output).toContain("Import dry run completed.");
    expect(output).toContain("Unsupported password scheme.");
    expect(output).not.toContain(secretKey);
  });

  it("uploads bounded batches and resumes after the last durable checkpoint", async () => {
    const checkpoints = memoryCheckpoints();
    const uploadedRows: number[] = [];
    let failAfterFirstBatch = true;
    const upload = vi.fn(async (options): Promise<ImportBatchResponse> => {
      const rows = [];
      for await (const record of options.records) rows.push(record);
      uploadedRows.push(rows.length);
      if (uploadedRows.length === 2 && failAfterFirstBatch) {
        throw new Error("synthetic transport failure");
      }
      return batch(rows.length, uploadedRows.length);
    });
    const options = {
      dryRun: false,
      filePath: "./synthetic.csv",
      from: "clerk" as const,
      json: true,
      projectId,
      sourceNamespace: "ins_large",
    };
    const dependencies = {
      adapters: { clerk: () => manyRecords(10_001) },
      checkpoints,
      env: {
        AUTHOWL_API_URL: "http://localhost:3010",
        AUTHOWL_SECRET_KEY: secretKey,
      },
      upload,
    };

    await expect(runImport(options, dependencies)).rejects.toThrow(
      "synthetic transport failure",
    );
    expect(uploadedRows).toEqual([10_000, 1]);
    expect(checkpoints.current()?.nextRow).toBe(10_000);

    failAfterFirstBatch = false;
    uploadedRows.length = 0;
    const output = await runImport(
      { ...options, resume: true },
      dependencies,
    );
    const summary = JSON.parse(output);
    expect(uploadedRows).toEqual([1]);
    expect(summary).toMatchObject({
      mode: "commit",
      status: "completed",
      resumed_from_row: 10_000,
      counts: {
        total: 10_001,
        created: 10_001,
      },
    });
    expect(summary.batches).toHaveLength(2);
    expect(checkpoints.current()).toBeNull();
  });

  it("streams 100,000 users through ten bounded uploads", async () => {
    const uploadedRows: number[] = [];
    const output = await runImport(
      {
        dryRun: false,
        filePath: "./large.csv",
        from: "clerk",
        json: true,
        projectId,
        sourceNamespace: "ins_100k",
      },
      {
        adapters: { clerk: () => manyRecords(100_000) },
        checkpoints: memoryCheckpoints(),
        env: {
          AUTHOWL_API_URL: "http://localhost:3010",
          AUTHOWL_SECRET_KEY: secretKey,
        },
        upload: async (options) => {
          let rows = 0;
          for await (const _record of options.records) rows += 1;
          uploadedRows.push(rows);
          return batch(rows, uploadedRows.length, "ins_100k");
        },
      },
    );

    expect(uploadedRows).toEqual(Array.from({ length: 10 }, () => 10_000));
    expect(JSON.parse(output)).toMatchObject({
      counts: {
        total: 100_000,
        created: 100_000,
      },
    });
  });
});

async function* records() {
  yield {
    type: "user" as const,
    external_id: "one",
    email: "one@example.test",
  };
}

async function* manyRecords(count: number) {
  for (let index = 0; index < count; index += 1) {
    yield {
      type: "user" as const,
      external_id: `user-${index}`,
      email: `user-${index}@example.test`,
    };
  }
}

function batch(
  rows: number,
  sequence: number,
  namespace = "ins_large",
): ImportBatchResponse {
  return {
    id: `33333333-3333-4333-8333-${sequence.toString().padStart(12, "0")}`,
    mode: "commit",
    status: "completed",
    schema_version: "authowl.user-import.v1",
    source: {
      provider: "clerk",
      namespace,
      version: "dashboard-export-2026-07",
    },
    counts: {
      total: rows,
      valid: rows,
      invalid: 0,
      created: rows,
      updated: 0,
      unchanged: 0,
      failed: 0,
    },
    bytes_received: rows * 100,
    errors_truncated: false,
    created_at: "2026-07-16T10:00:00.000Z",
    completed_at: "2026-07-16T10:00:00.000Z",
  };
}

function memoryCheckpoints(): ImportCheckpointStore & {
  current(): ImportCheckpoint | null;
} {
  let checkpoint: ImportCheckpoint | null = null;
  return {
    acquire: async () => async () => undefined,
    current: () => checkpoint,
    fingerprint: async () => ({
      bytes: 42,
      modifiedAtMs: 1_752_662_400_000,
      sha256: "a".repeat(64),
    }),
    load: async () => checkpoint,
    remove: async () => {
      checkpoint = null;
    },
    save: async (value) => {
      checkpoint = structuredClone(value);
    },
  };
}
