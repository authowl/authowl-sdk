export const CANONICAL_IMPORT_SCHEMA_VERSION =
  "authowl.user-import.v1" as const;

/** Must stay within the server's canonical import row and body bounds. */
export const IMPORT_UPLOAD_POLICY = {
  maxRows: 10_000,
  maxBytes: 48 * 1024 * 1024,
} as const;

/** Bounded local reads, including expanded gzip content. */
export const IMPORT_SOURCE_POLICY = {
  maxSourceBytes: 512 * 1024 * 1024,
} as const;

export const IMPORT_PROVIDERS = [
  "clerk",
  "auth0",
  "firebase",
  "supabase",
  "better-auth",
  "authowl",
  "custom",
] as const;

export type ImportProvider = (typeof IMPORT_PROVIDERS)[number];

export type JsonObject = Record<string, unknown>;

export type CanonicalPasswordEnvelope = {
  scheme: string;
  hash: string;
  parameters?: JsonObject;
};

export type CanonicalExternalAccount = {
  provider: string;
  provider_user_id: string;
  email?: string;
  email_verified?: boolean;
};

export type CanonicalUserRecord = {
  type: "user";
  external_id: string;
  email?: string | null;
  email_verified?: boolean;
  phone?: string | null;
  phone_verified?: boolean;
  name?: string | null;
  image_url?: string | null;
  password?: CanonicalPasswordEnvelope;
  external_accounts?: CanonicalExternalAccount[];
  organization_slugs?: string[];
  public_metadata?: JsonObject;
  private_metadata?: JsonObject;
  unsafe_metadata?: JsonObject;
  created_at?: string;
};

export type CanonicalImportManifest = {
  type: "manifest";
  schema_version: typeof CANONICAL_IMPORT_SCHEMA_VERSION;
  source: {
    provider: ImportProvider;
    namespace: string;
    version: string;
  };
};

export type ImportBatchResponse = {
  id: string;
  mode: "dry_run" | "commit";
  status: string;
  schema_version: string;
  source: {
    provider: string;
    namespace: string;
    version: string | null;
  };
  counts: {
    total: number;
    valid: number;
    invalid: number;
    created?: number;
    updated?: number;
    unchanged?: number;
    failed?: number;
  };
  bytes_received: number;
  errors_truncated: boolean;
  errors?: Array<{
    line: number;
    code: string;
    path: string | null;
    message: string;
  }>;
  report_expires_at?: string | null;
  created_at: string;
  completed_at: string | null;
};
