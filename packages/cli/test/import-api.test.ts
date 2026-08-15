import { describe, expect, it, vi } from "vitest";
import {
  uploadCanonicalImport,
  type ImportApiOptions,
} from "../src/import/import-api";
import { ImportSourceError } from "../src/import/source-reader";

const projectId = "11111111-1111-4111-8111-111111111111";
const secretKey = `sk_test_${projectId}_${"S".repeat(32)}`;

describe("canonical import uploader", () => {
  it("streams canonical NDJSON with the secret only in the bearer header", async () => {
    let receivedBody = "";
    const request = vi.fn<typeof fetch>(async (url, init) => {
      receivedBody = await new Response(init?.body).text();
      expect(String(url)).toBe(
        "http://localhost:3010/api/v1/imports/dry-run",
      );
      expect(String(url)).not.toContain(secretKey);
      expect(new Headers(init?.headers).get("authorization")).toBe(
        `Bearer ${secretKey}`,
      );
      expect(new Headers(init?.headers).get("content-type")).toBe(
        "application/x-ndjson",
      );
      return Response.json(batch("dry_run"), { status: 201 });
    });

    const result = await uploadCanonicalImport(
      options(),
      { fetch: request },
    );

    expect(result.mode).toBe("dry_run");
    expect(
      receivedBody
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    ).toEqual([
      options().manifest,
      {
        type: "user",
        external_id: "source-user-1",
        email: "person@example.test",
        email_verified: true,
      },
    ]);
    expect(receivedBody).not.toContain(secretKey);
  });

  it("refuses project mismatches and malformed namespaces before network access", async () => {
    const request = vi.fn<typeof fetch>();
    await expect(
      uploadCanonicalImport(
        { ...options(), projectId: "22222222-2222-4222-8222-222222222222" },
        { fetch: request },
      ),
    ).rejects.toThrow("different project");
    await expect(
      uploadCanonicalImport(
        {
          ...options(),
          manifest: {
            ...options().manifest,
            source: { ...options().manifest.source, namespace: "../ bad" },
          },
        },
        { fetch: request },
      ),
    ).rejects.toThrow("--source-namespace");
    expect(request).not.toHaveBeenCalled();
  });

  it("returns sanitized problem details without retaining the secret", async () => {
    const error = await uploadCanonicalImport(options(), {
      fetch: async () =>
        Response.json(
          {
            detail: "Invalid\u001b[31m import",
            code: "IMPORT_VALIDATION_FAILED",
          },
          { status: 422 },
        ),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("Invalid�[31m import");
    expect((error as Error).message).not.toContain(secretKey);
  });

  it("preserves provider row diagnostics raised while fetch consumes the stream", async () => {
    async function* brokenRecords() {
      throw new ImportSourceError("Auth0 row 9 has malformed metadata.");
      yield {
        type: "user" as const,
        external_id: "unreachable",
        email: "unreachable@example.test",
      };
    }
    const error = await uploadCanonicalImport(
      { ...options(), records: brokenRecords() },
      {
        fetch: async (_url, init) => {
          await new Response(init?.body).text();
          return Response.json(batch("dry_run"), { status: 201 });
        },
      },
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      "Auth0 row 9 has malformed metadata.",
    );
  });
});

function options(): ImportApiOptions {
  return {
    apiUrl: "http://localhost:3010",
    dryRun: true,
    manifest: {
      type: "manifest",
      schema_version: "authowl.user-import.v1",
      source: {
        provider: "clerk",
        namespace: "instance_synthetic",
        version: "dashboard-export-2026-07",
      },
    },
    projectId,
    records: records(),
    secretKey,
  };
}

async function* records() {
  yield {
    type: "user" as const,
    external_id: "source-user-1",
    email: "person@example.test",
    email_verified: true,
  };
}

function batch(mode: "dry_run" | "commit") {
  return {
    id: "33333333-3333-4333-8333-333333333333",
    mode,
    status: mode === "dry_run" ? "validated" : "completed",
    schema_version: "authowl.user-import.v1",
    source: {
      provider: "clerk",
      namespace: "instance_synthetic",
      version: "dashboard-export-2026-07",
    },
    counts: { total: 1, valid: 1, invalid: 0 },
    bytes_received: 300,
    errors_truncated: false,
    errors: [],
    created_at: "2026-07-16T10:00:00.000Z",
    completed_at: "2026-07-16T10:00:00.000Z",
  };
}
