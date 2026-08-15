import { IMPORT_UPLOAD_POLICY, type CanonicalUserRecord } from "./contracts";

export async function* chunkImportRecords(
  records: AsyncIterable<CanonicalUserRecord>,
  skipRows: number,
): AsyncGenerator<{ records: CanonicalUserRecord[]; endRow: number }> {
  let seenRows = 0;
  let chunk: CanonicalUserRecord[] = [];
  let chunkBytes = 0;
  for await (const record of records) {
    seenRows += 1;
    if (seenRows <= skipRows) continue;
    const recordBytes = Buffer.byteLength(JSON.stringify(record), "utf8") + 1;
    if (
      chunk.length > 0 &&
      (chunk.length >= IMPORT_UPLOAD_POLICY.maxRows ||
        chunkBytes + recordBytes > IMPORT_UPLOAD_POLICY.maxBytes)
    ) {
      yield { records: chunk, endRow: seenRows - 1 };
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(record);
    chunkBytes += recordBytes;
  }
  if (seenRows < skipRows) {
    throw new Error(
      "The import checkpoint is beyond the end of this source file.",
    );
  }
  if (chunk.length > 0) {
    yield { records: chunk, endRow: seenRows };
  }
}

export async function* recordsFromArray(
  records: CanonicalUserRecord[],
): AsyncGenerator<CanonicalUserRecord> {
  yield* records;
}
