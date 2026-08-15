import { resolveApiUrl } from "../api-url";
import { CLI_USER_AGENT } from "../metadata";
import { terminalText } from "../terminal";
import type {
  CanonicalImportManifest,
  CanonicalUserRecord,
  ImportBatchResponse,
} from "./contracts";
import { parseImportBatchResponse } from "./response-contract";
import { ImportSourceError, isRecord } from "./source-reader";

const SECRET_KEY_PATTERN =
  /^sk_(?:live|test)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_[A-Za-z0-9]{20,}$/i;
const SOURCE_NAMESPACE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;
const REQUEST_TIMEOUT_MS = 120_000;

export type ImportApiOptions = {
  apiUrl?: string;
  dryRun: boolean;
  manifest: CanonicalImportManifest;
  projectId: string;
  records: AsyncIterable<CanonicalUserRecord>;
  secretKey: string | undefined;
};

export type ImportApiDependencies = {
  fetch?: typeof fetch;
  signal?: AbortSignal;
};

export async function uploadCanonicalImport(
  options: ImportApiOptions,
  dependencies: ImportApiDependencies = {},
): Promise<ImportBatchResponse> {
  const secretKey = validateSecretKey(options.secretKey, options.projectId);
  validateNamespace(options.manifest.source.namespace);
  const apiUrl = resolveApiUrl(options.apiUrl);
  const path = options.dryRun ? "/api/v1/imports/dry-run" : "/api/v1/imports";
  const body = canonicalBody(options.manifest, options.records);
  const signal = dependencies.signal
    ? AbortSignal.any([
        dependencies.signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ])
    : AbortSignal.timeout(REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(`${apiUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json, application/problem+json",
        authorization: `Bearer ${secretKey}`,
        "content-type": "application/x-ndjson",
        "user-agent": CLI_USER_AGENT,
      },
      body,
      duplex: "half",
      redirect: "error",
      signal,
    } as RequestInit & { duplex: "half" });
  } catch (error) {
    const sourceError = findImportSourceError(error);
    if (sourceError) throw new Error(terminalText(sourceError.message));
    if (isAbortError(error)) {
      throw new Error("The AuthOwl import request was aborted.");
    }
    throw new Error("The AuthOwl import request could not be completed.");
  }

  let payload: unknown;
  const contentType = response.headers.get("content-type");
  if (!contentType || !/(^|[+/])json(?:;|$)/i.test(contentType)) {
    throw new Error("AuthOwl returned an invalid import response.");
  }
  try {
    payload = await response.json();
  } catch {
    throw new Error("AuthOwl returned an invalid import response.");
  }
  if (!response.ok) {
    const detail =
      isRecord(payload) && typeof payload.detail === "string"
        ? payload.detail
        : "AuthOwl rejected the import.";
    const code =
      isRecord(payload) && typeof payload.code === "string"
        ? payload.code
        : `HTTP_${response.status}`;
    throw new Error(`${terminalText(detail)} (${terminalText(code)})`);
  }
  return parseImportBatchResponse(payload);
}

function canonicalBody(
  manifest: CanonicalImportManifest,
  records: AsyncIterable<CanonicalUserRecord>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = canonicalLines(manifest, records)[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(next.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.(undefined);
    },
  });
}

async function* canonicalLines(
  manifest: CanonicalImportManifest,
  records: AsyncIterable<CanonicalUserRecord>,
): AsyncGenerator<string> {
  yield `${JSON.stringify(manifest)}\n`;
  let count = 0;
  for await (const record of records) {
    count += 1;
    yield `${JSON.stringify(record)}\n`;
  }
  if (count === 0) {
    throw new ImportSourceError("The provider export contains no users.");
  }
}

function validateSecretKey(
  secretKey: string | undefined,
  projectId: string,
): string {
  if (!secretKey) {
    throw new Error(
      "AUTHOWL_SECRET_KEY is required and must grant the users:write scope.",
    );
  }
  const match = SECRET_KEY_PATTERN.exec(secretKey.trim());
  if (!match) {
    throw new Error("AUTHOWL_SECRET_KEY is malformed.");
  }
  if (match[1]!.toLowerCase() !== projectId.toLowerCase()) {
    throw new Error(
      "The AuthOwl secret key belongs to a different project than --project.",
    );
  }
  return secretKey.trim();
}

function validateNamespace(namespace: string): void {
  if (
    namespace.length === 0 ||
    !SOURCE_NAMESPACE_PATTERN.test(namespace)
  ) {
    throw new Error(
      "--source-namespace must identify the source instance using letters, numbers, '.', '_', ':', '/', or '-'.",
    );
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function findImportSourceError(error: unknown): ImportSourceError | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (current instanceof ImportSourceError) return current;
    if (!isRecord(current)) return undefined;
    current = current.cause;
  }
  return undefined;
}
