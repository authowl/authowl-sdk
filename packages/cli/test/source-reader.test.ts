import { gzipSync } from "node:zlib";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readNdjsonRecords } from "../src/import/source-reader";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("import source reader safety", () => {
  it("stops gzip expansion at the configured source bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "authowl-source-reader-"));
    temporaryDirectories.push(root);
    const source = join(root, "users.ndjson.gz");
    await writeFile(
      source,
      gzipSync(
        `${JSON.stringify({
          id: "user_1",
          metadata: "x".repeat(1_024),
        })}\n`,
      ),
    );

    await expect(
      collect(readNdjsonRecords(source, { maxSourceBytes: 128 })),
    ).rejects.toThrow("expanded import source exceeds");
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const collected: T[] = [];
  for await (const value of values) collected.push(value);
  return collected;
}
