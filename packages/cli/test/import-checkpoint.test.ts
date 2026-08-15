import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createImportCheckpointStore,
  type ImportCheckpoint,
  type ImportCheckpointIdentity,
} from "../src/import/checkpoint";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("import checkpoints", () => {
  it("fingerprints sources and atomically stores private progress outside the project", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "users.csv");
    const config = join(root, "config");
    await writeFile(source, "id,email\nuser_1,one@example.test\n");
    const store = createImportCheckpointStore({ AUTHOWL_CONFIG_HOME: config });
    const identity = checkpointIdentity(source);
    const fingerprint = await store.fingerprint(source);
    const checkpoint: ImportCheckpoint = {
      version: 1,
      identity,
      fingerprint,
      nextRow: 0,
      batches: [],
      updatedAt: "2026-07-16T18:00:00.000Z",
    };

    await store.save(checkpoint);
    await expect(store.load(identity)).resolves.toEqual(checkpoint);
    const importsDirectory = join(config, "imports");
    const files = await readdir(importsDirectory);
    expect(files).toHaveLength(1);
    expect((await stat(importsDirectory)).mode & 0o777).toBe(0o700);
    expect((await stat(join(importsDirectory, files[0]!))).mode & 0o777).toBe(
      0o600,
    );

    await store.remove(identity);
    await expect(store.load(identity)).resolves.toBeNull();
  });

  it("changes the fingerprint when the source changes", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "users.ndjson");
    const store = createImportCheckpointStore({
      AUTHOWL_CONFIG_HOME: join(root, "config"),
    });
    await writeFile(source, '{"id":"one"}\n');
    const first = await store.fingerprint(source);
    await writeFile(source, '{"id":"two"}\n');
    const second = await store.fingerprint(source);
    expect(second.sha256).not.toBe(first.sha256);
  });

  it("serializes imports for the same source and destination", async () => {
    const root = await temporaryDirectory();
    const source = join(root, "users.csv");
    await writeFile(source, "id,email\nuser_1,one@example.test\n");
    const store = createImportCheckpointStore({
      AUTHOWL_CONFIG_HOME: join(root, "config"),
    });
    const identity = checkpointIdentity(source);

    const release = await store.acquire(identity);
    await expect(store.acquire(identity)).rejects.toThrow(
      "already using this source and destination",
    );
    await release();
    const releaseAgain = await store.acquire(identity);
    await releaseAgain();
  });
});

function checkpointIdentity(filePath: string): ImportCheckpointIdentity {
  return {
    dryRun: false,
    filePath,
    projectId: "11111111-1111-4111-8111-111111111111",
    provider: "clerk",
    sourceNamespace: "ins_synthetic",
    sourceVersion: "dashboard-export-2026-07",
  };
}

async function temporaryDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "authowl-import-checkpoint-"));
  temporaryDirectories.push(path);
  return path;
}
