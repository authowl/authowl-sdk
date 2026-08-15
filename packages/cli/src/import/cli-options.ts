import { isUuid } from "../cli-api";
import { IMPORT_PROVIDERS, type ImportProvider } from "./contracts";
import type { RunImportOptions } from "./run-import";

export type ImportCliValues = {
  "api-url"?: string;
  "dry-run"?: boolean;
  "firebase-hash-config"?: string;
  from?: string;
  json?: boolean;
  project?: string;
  "project-id"?: string;
  resume?: boolean;
  "source-namespace"?: string;
};

export function parseImportCliOptions(
  positionals: string[],
  values: ImportCliValues,
  signal?: AbortSignal,
): RunImportOptions {
  const filePath = positionals[1];
  if (!filePath) {
    throw new Error(
      "Missing provider export file. Usage: authowl import <file> --from <provider> --project <id> --source-namespace <namespace>",
    );
  }
  if (positionals.length > 2) {
    throw new Error(`Unexpected argument: ${positionals[2]}`);
  }
  const sourceNamespace = values["source-namespace"]?.trim();
  if (!sourceNamespace) {
    throw new Error(
      "Missing --source-namespace. Use the stable source project, tenant, or database identifier.",
    );
  }
  const provider = parseImportProvider(values.from);
  if (values["firebase-hash-config"] && provider !== "firebase") {
    throw new Error(
      "--firebase-hash-config is valid only with --from firebase.",
    );
  }
  return {
    apiUrl: values["api-url"],
    dryRun: values["dry-run"],
    filePath,
    firebaseHashConfigPath: values["firebase-hash-config"],
    from: provider,
    json: values.json,
    projectId: importProjectId(values.project, values["project-id"]),
    resume: values.resume,
    sourceNamespace,
    signal,
  };
}

function parseImportProvider(value: string | undefined): ImportProvider {
  if (
    value &&
    IMPORT_PROVIDERS.includes(value.toLowerCase() as ImportProvider)
  ) {
    return value.toLowerCase() as ImportProvider;
  }
  throw new Error(
    "Missing or unsupported --from. Use clerk, auth0, firebase, supabase, better-auth, authowl, or custom.",
  );
}

function importProjectId(
  project: string | undefined,
  projectId: string | undefined,
): string {
  if (project && projectId && project !== projectId) {
    throw new Error(
      "--project and --project-id must identify the same project.",
    );
  }
  const value = (project ?? projectId)?.trim();
  if (!value) throw new Error("Missing --project for the destination project.");
  if (!isUuid(value)) throw new Error("The AuthOwl project id is malformed.");
  return value;
}
