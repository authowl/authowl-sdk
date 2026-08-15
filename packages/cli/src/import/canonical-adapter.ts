import type { CanonicalUserRecord, ImportProvider } from "./contracts";
import {
  ImportSourceError,
  isRecord,
  readCsvRecords,
  readJsonArrayRecords,
  readNdjsonRecords,
  sniffSourceFormat,
  type SourceRecord,
} from "./source-reader";
import { optionalString } from "./shared";
import { adaptCanonicalUser } from "./canonical-fields";

export { adaptCanonicalUser } from "./canonical-fields";

export const CANONICAL_SOURCE_VERSION = "authowl-canonical-v1";

export type CanonicalAdapterOptions = {
  provider: Extract<ImportProvider, "authowl" | "custom">;
  sourceNamespace: string;
};

export async function* adaptCanonicalExport(
  filePath: string,
  options: CanonicalAdapterOptions,
): AsyncGenerator<CanonicalUserRecord> {
  const format = await sniffSourceFormat(filePath);
  const records =
    format === "csv"
      ? readCsvRecords(filePath)
      : format === "json-array"
        ? readJsonArrayRecords(filePath)
        : readNdjsonRecords(filePath);
  let row = 0;
  let users = 0;
  for await (const record of records) {
    row += 1;
    if (record.type === "manifest") {
      if (row !== 1 || format !== "ndjson") {
        throw new ImportSourceError(
          "A canonical manifest is accepted only as the first NDJSON record.",
        );
      }
      validateManifest(record, options);
      continue;
    }
    users += 1;
    yield adaptCanonicalUser(record, row);
  }
  if (users === 0) {
    throw new ImportSourceError("The canonical source contains no user rows.");
  }
}

function validateManifest(
  manifest: SourceRecord,
  options: CanonicalAdapterOptions,
): void {
  assertObjectKeys(
    manifest,
    new Set(["type", "schema_version", "source"]),
    "Canonical manifest",
  );
  if (manifest.schema_version !== "authowl.user-import.v1") {
    throw new ImportSourceError(
      "The canonical manifest schema_version is unsupported.",
    );
  }
  const source = parseObject(manifest.source, "Canonical manifest source");
  assertObjectKeys(
    source,
    new Set(["provider", "namespace", "version"]),
    "Canonical manifest source",
  );
  if (
    source.provider !== options.provider ||
    source.namespace !== options.sourceNamespace
  ) {
    throw new ImportSourceError(
      "The canonical manifest source must match --from and --source-namespace.",
    );
  }
  if (source.version !== undefined && !optionalString(source.version)) {
    throw new ImportSourceError(
      "The canonical manifest source version must be a non-empty string.",
    );
  }
}

function assertObjectKeys(
  value: SourceRecord,
  allowed: Set<string>,
  location: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new ImportSourceError(
      `${location} contains unsupported field ${unexpected[0]}.`,
    );
  }
}

function parseObject(value: unknown, location: string): SourceRecord {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new ImportSourceError(`${location} must be a JSON object.`);
    }
  }
  if (!isRecord(parsed)) {
    throw new ImportSourceError(`${location} must be a JSON object.`);
  }
  return parsed;
}
