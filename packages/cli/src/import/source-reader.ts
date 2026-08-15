import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { Transform, type Readable } from "node:stream";
import { parse } from "csv-parse";
import streamJson from "stream-json";
import Pick from "stream-json/filters/Pick.js";
import StreamArray from "stream-json/streamers/StreamArray.js";
import { IMPORT_SOURCE_POLICY } from "./contracts";

export type SourceRecord = Record<string, unknown>;

export class ImportSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportSourceError";
  }
}

export async function sniffSourceFormat(
  filePath: string,
): Promise<"csv" | "json-array" | "ndjson"> {
  let prefix: string;
  try {
    prefix = await readSourcePrefix(filePath);
  } catch {
    throw new ImportSourceError("The import source file could not be opened.");
  }
  const firstContent = prefix
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));
  if (!firstContent) {
    throw new ImportSourceError("The import source file is empty.");
  }
  if (firstContent.startsWith("[")) return "json-array";
  if (firstContent.startsWith("{")) return "ndjson";
  return "csv";
}

export async function* readCsvRecords(
  filePath: string,
): AsyncGenerator<SourceRecord> {
  const records = createSourceStream(filePath).pipe(
    parse({
      bom: true,
      columns: true,
      comment: "#",
      comment_no_infix: true,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true,
    }),
  );
  try {
    let row = 1;
    for await (const value of records) {
      row += 1;
      if (!isRecord(value)) {
        throw new ImportSourceError(`CSV row ${row} is not an object.`);
      }
      yield value;
    }
  } catch (error) {
    throw importSourceError(
      error,
      "The CSV import source is malformed or unreadable.",
    );
  }
}

export async function* readCsvRows(filePath: string): AsyncGenerator<string[]> {
  const records = createSourceStream(filePath).pipe(
    parse({
      bom: true,
      comment: "#",
      comment_no_infix: true,
      relax_column_count: false,
      skip_empty_lines: true,
      trim: true,
    }),
  );
  try {
    let row = 0;
    for await (const value of records) {
      row += 1;
      if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === "string")
      ) {
        throw new ImportSourceError(`CSV row ${row} is malformed.`);
      }
      yield value;
    }
  } catch (error) {
    throw importSourceError(
      error,
      "The CSV import source is malformed or unreadable.",
    );
  }
}

export async function* readJsonArrayRecords(
  filePath: string,
): AsyncGenerator<SourceRecord> {
  const values = createSourceStream(filePath)
    .pipe(streamJson.parser())
    .pipe(StreamArray.streamArray());
  try {
    for await (const entry of values) {
      const value = isRecord(entry) ? entry.value : undefined;
      const index =
        isRecord(entry) && typeof entry.key === "number" ? entry.key : -1;
      if (!isRecord(value)) {
        throw new ImportSourceError(
          `JSON array item ${index + 1} is not an object.`,
        );
      }
      yield value;
    }
  } catch (error) {
    throw importSourceError(
      error,
      "The JSON import source is malformed or unreadable.",
    );
  }
}

export async function* readJsonPropertyArrayRecords(
  filePath: string,
  property: string,
): AsyncGenerator<SourceRecord> {
  const values = createSourceStream(filePath)
    .pipe(streamJson.parser())
    .pipe(Pick.pick({ filter: property }))
    .pipe(StreamArray.streamArray());
  try {
    for await (const entry of values) {
      const value = isRecord(entry) ? entry.value : undefined;
      const index =
        isRecord(entry) && typeof entry.key === "number" ? entry.key : -1;
      if (!isRecord(value)) {
        throw new ImportSourceError(
          `JSON ${property} item ${index + 1} is not an object.`,
        );
      }
      yield value;
    }
  } catch (error) {
    throw importSourceError(
      error,
      `The JSON import source does not contain a readable ${property} array.`,
    );
  }
}

export async function* readNdjsonRecords(
  filePath: string,
  options: { maxSourceBytes?: number } = {},
): AsyncGenerator<SourceRecord> {
  const lines = createInterface({
    input: createSourceStream(filePath, options.maxSourceBytes),
    crlfDelay: Infinity,
  });
  try {
    let lineNumber = 0;
    for await (const line of lines) {
      lineNumber += 1;
      if (!line.trim()) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new ImportSourceError(
          `NDJSON line ${lineNumber} is not valid JSON.`,
        );
      }
      if (!isRecord(value)) {
        throw new ImportSourceError(
          `NDJSON line ${lineNumber} is not an object.`,
        );
      }
      yield value;
    }
  } catch (error) {
    throw importSourceError(
      error,
      "The NDJSON import source is malformed or unreadable.",
    );
  }
}

export function isRecord(value: unknown): value is SourceRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function importSourceError(
  error: unknown,
  fallback: string,
): ImportSourceError {
  return error instanceof ImportSourceError
    ? error
    : new ImportSourceError(fallback);
}

function createSourceStream(
  filePath: string,
  maxSourceBytes = IMPORT_SOURCE_POLICY.maxSourceBytes,
): Readable {
  const input = createReadStream(filePath);
  const source = filePath.toLowerCase().endsWith(".gz")
    ? input.pipe(createGunzip())
    : input;
  let bytes = 0;
  return source.pipe(new Transform({
    transform(chunk, _encoding, callback) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += value.length;
      if (bytes > maxSourceBytes) {
        callback(new ImportSourceError(
          `The expanded import source exceeds the ${maxSourceBytes}-byte safety limit.`,
        ));
        return;
      }
      callback(null, value);
    },
  }));
}

async function readSourcePrefix(filePath: string): Promise<string> {
  const stream = createSourceStream(filePath);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    chunks.push(chunk);
    size += chunk.length;
    if (size >= 4096) break;
  }
  return Buffer.concat(chunks, size).subarray(0, 4096).toString("utf8");
}
