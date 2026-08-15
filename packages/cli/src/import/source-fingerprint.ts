import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { IMPORT_SOURCE_POLICY } from "./contracts";

export type ImportSourceFingerprint = {
  bytes: number;
  modifiedAtMs: number;
  sha256: string;
};

export async function fingerprintImportSource(
  filePath: string,
): Promise<ImportSourceFingerprint> {
  const before = await stat(filePath);
  if (!before.isFile()) {
    throw new Error("The import source must be a regular file.");
  }
  if (before.size > IMPORT_SOURCE_POLICY.maxSourceBytes) {
    throw new Error(
      `The import source exceeds the ${IMPORT_SOURCE_POLICY.maxSourceBytes}-byte safety limit.`,
    );
  }
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    digest.update(value);
    bytes += value.length;
  }
  const after = await stat(filePath);
  if (
    before.size !== after.size ||
    before.mtimeMs !== after.mtimeMs ||
    bytes !== after.size
  ) {
    throw new Error(
      "The import source changed while AuthOwl was fingerprinting it.",
    );
  }
  return {
    bytes,
    modifiedAtMs: after.mtimeMs,
    sha256: digest.digest("hex"),
  };
}
