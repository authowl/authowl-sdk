import { resolve } from "node:path";
import {
  CANONICAL_IMPORT_SCHEMA_VERSION,
  type CanonicalImportManifest,
  type ImportProvider,
} from "./contracts";
import {
  IMPORT_ADAPTERS,
  IMPORT_SOURCE_VERSIONS,
  type ImportAdapter,
} from "./adapter-registry";
import {
  uploadCanonicalImport,
  type ImportApiDependencies,
} from "./import-api";
import {
  createImportCheckpointStore,
  type ImportCheckpoint,
  type ImportCheckpointIdentity,
  type ImportCheckpointStore,
} from "./checkpoint";
import { chunkImportRecords, recordsFromArray } from "./chunks";
import { ImportSourceError } from "./source-reader";
import {
  formatImportRun,
  summarizeImportRun,
} from "./summary";

export { formatImportRun, type ImportRunSummary } from "./summary";

export type RunImportOptions = {
  apiUrl?: string;
  dryRun?: boolean;
  filePath: string;
  firebaseHashConfigPath?: string;
  from: ImportProvider;
  json?: boolean;
  projectId: string;
  resume?: boolean;
  sourceNamespace: string;
  signal?: AbortSignal;
};

export type RunImportDependencies = ImportApiDependencies & {
  adapters?: Partial<Record<ImportProvider, ImportAdapter>>;
  env?: NodeJS.ProcessEnv;
  checkpoints?: ImportCheckpointStore;
  upload?: typeof uploadCanonicalImport;
};

export async function runImport(
  options: RunImportOptions,
  dependencies: RunImportDependencies = {},
): Promise<string> {
  const env = dependencies.env ?? process.env;
  const sourceVersion = IMPORT_SOURCE_VERSIONS[options.from];
  const sourceNamespace = options.sourceNamespace.trim();
  const dryRun = options.dryRun ?? false;
  const manifest: CanonicalImportManifest = {
    type: "manifest",
    schema_version: CANONICAL_IMPORT_SCHEMA_VERSION,
    source: {
      provider: options.from,
      namespace: sourceNamespace,
      version: sourceVersion,
    },
  };
  const filePath = resolve(options.filePath);
  const identity: ImportCheckpointIdentity = {
    dryRun,
    filePath,
    projectId: options.projectId,
    provider: options.from,
    sourceNamespace,
    sourceVersion,
  };
  const checkpoints =
    dependencies.checkpoints ?? createImportCheckpointStore(env);
  const release = await checkpoints.acquire(identity);
  try {
    return await runCheckpointedImport({
      options,
      dependencies,
      env,
      manifest,
      filePath,
      identity,
      checkpoints,
    });
  } finally {
    await release();
  }
}

async function runCheckpointedImport(input: {
  options: RunImportOptions;
  dependencies: RunImportDependencies;
  env: NodeJS.ProcessEnv;
  manifest: CanonicalImportManifest;
  filePath: string;
  identity: ImportCheckpointIdentity;
  checkpoints: ImportCheckpointStore;
}): Promise<string> {
  const {
    options,
    dependencies,
    env,
    manifest,
    filePath,
    identity,
    checkpoints,
  } = input;
  const fingerprint = await checkpoints.fingerprint(filePath);
  const existingCheckpoint = options.resume
    ? await checkpoints.load(identity)
    : null;
  if (options.resume && !existingCheckpoint) {
    throw new Error(
      "No matching AuthOwl import checkpoint exists for this source and destination.",
    );
  }
  if (
    existingCheckpoint &&
    !sameFingerprint(existingCheckpoint.fingerprint, fingerprint)
  ) {
    throw new Error(
      "The import source changed after the checkpoint was created. Start a new import without --resume.",
    );
  }
  let checkpoint = existingCheckpoint ?? initialCheckpoint(identity, fingerprint);
  if (!existingCheckpoint) await checkpoints.save(checkpoint);
  const resumedFromRow = checkpoint.nextRow;
  const adapter =
    dependencies.adapters?.[options.from] ?? IMPORT_ADAPTERS[options.from];
  const records = adapter(filePath, {
    firebaseHashConfigPath: options.firebaseHashConfigPath
      ? resolve(options.firebaseHashConfigPath)
      : undefined,
    provider: options.from,
    sourceNamespace: identity.sourceNamespace,
  });
  let uploadedChunks = 0;
  for await (const chunk of chunkImportRecords(records, checkpoint.nextRow)) {
    const batch = await (dependencies.upload ?? uploadCanonicalImport)(
      {
        apiUrl: options.apiUrl ?? env.AUTHOWL_API_URL,
        dryRun: identity.dryRun,
        manifest,
        projectId: options.projectId,
        records: recordsFromArray(chunk.records),
        secretKey: env.AUTHOWL_SECRET_KEY,
      },
      {
        fetch: dependencies.fetch,
        signal: options.signal ?? dependencies.signal,
      },
    );
    checkpoint = {
      ...checkpoint,
      nextRow: chunk.endRow,
      batches: [...checkpoint.batches, batch],
      updatedAt: new Date().toISOString(),
    };
    await checkpoints.save(checkpoint);
    uploadedChunks += 1;
  }
  if (uploadedChunks === 0 && checkpoint.nextRow === 0) {
    throw new ImportSourceError("The provider export contains no users.");
  }
  const finalFingerprint = await checkpoints.fingerprint(filePath);
  if (!sameFingerprint(fingerprint, finalFingerprint)) {
    throw new Error(
      "The import source changed while AuthOwl was processing it. Resume is disabled for the changed file.",
    );
  }
  await checkpoints.remove(identity);
  const summary = summarizeImportRun(
    manifest,
    checkpoint.batches,
    resumedFromRow,
    identity.dryRun ? "dry_run" : "commit",
  );
  return options.json
    ? JSON.stringify(summary, null, 2)
    : formatImportRun(summary);
}

function initialCheckpoint(
  identity: ImportCheckpointIdentity,
  fingerprint: ImportCheckpoint["fingerprint"],
): ImportCheckpoint {
  return {
    version: 1,
    identity,
    fingerprint,
    nextRow: 0,
    batches: [],
    updatedAt: new Date().toISOString(),
  };
}

function sameFingerprint(
  left: ImportCheckpoint["fingerprint"],
  right: ImportCheckpoint["fingerprint"],
): boolean {
  return (
    left.bytes === right.bytes &&
    left.modifiedAtMs === right.modifiedAtMs &&
    left.sha256 === right.sha256
  );
}
