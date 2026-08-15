import { adaptAuth0Export, AUTH0_SOURCE_VERSION } from "./auth0-adapter";
import {
  adaptBetterAuthExport,
  BETTER_AUTH_SOURCE_VERSION,
} from "./better-auth-adapter";
import {
  adaptCanonicalExport,
  CANONICAL_SOURCE_VERSION,
} from "./canonical-adapter";
import { adaptClerkExport, CLERK_SOURCE_VERSION } from "./clerk-adapter";
import type { CanonicalUserRecord, ImportProvider } from "./contracts";
import {
  adaptFirebaseExport,
  FIREBASE_SOURCE_VERSION,
} from "./firebase-adapter";
import {
  adaptSupabaseExport,
  SUPABASE_SOURCE_VERSION,
} from "./supabase-adapter";

export type ImportAdapterContext = {
  firebaseHashConfigPath?: string;
  provider: ImportProvider;
  sourceNamespace: string;
};

export type ImportAdapter = (
  filePath: string,
  context: ImportAdapterContext,
) => AsyncIterable<CanonicalUserRecord>;

export const IMPORT_SOURCE_VERSIONS = {
  clerk: CLERK_SOURCE_VERSION,
  auth0: AUTH0_SOURCE_VERSION,
  firebase: FIREBASE_SOURCE_VERSION,
  supabase: SUPABASE_SOURCE_VERSION,
  "better-auth": BETTER_AUTH_SOURCE_VERSION,
  authowl: CANONICAL_SOURCE_VERSION,
  custom: CANONICAL_SOURCE_VERSION,
} as const satisfies Record<ImportProvider, string>;

export const IMPORT_ADAPTERS = {
  clerk: (filePath) => adaptClerkExport(filePath),
  auth0: (filePath) => adaptAuth0Export(filePath),
  firebase: (filePath, context) =>
    adaptFirebaseExport(filePath, {
      hashConfigPath: context.firebaseHashConfigPath,
    }),
  supabase: (filePath) => adaptSupabaseExport(filePath),
  "better-auth": (filePath) => adaptBetterAuthExport(filePath),
  authowl: (filePath, context) =>
    adaptCanonicalExport(filePath, {
      provider: "authowl",
      sourceNamespace: context.sourceNamespace,
    }),
  custom: (filePath, context) =>
    adaptCanonicalExport(filePath, {
      provider: "custom",
      sourceNamespace: context.sourceNamespace,
    }),
} as const satisfies Record<ImportProvider, ImportAdapter>;
