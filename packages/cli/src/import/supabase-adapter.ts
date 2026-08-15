import type {
  CanonicalExternalAccount,
  CanonicalUserRecord,
} from "./contracts";
import {
  ImportSourceError,
  isRecord,
  readCsvRecords,
  readJsonArrayRecords,
  sniffSourceFormat,
  type SourceRecord,
} from "./source-reader";
import {
  directPassword,
  joinedName,
  normalizedScheme,
  optionalBoolean,
  optionalObject,
  optionalString,
  optionalTimestamp,
} from "./shared";

export const SUPABASE_SOURCE_VERSION = "auth-schema-export-2026-07";

export async function* adaptSupabaseExport(
  filePath: string,
): AsyncGenerator<CanonicalUserRecord> {
  const format = await sniffSourceFormat(filePath);
  if (format === "ndjson") {
    throw new ImportSourceError(
      "Supabase imports accept an auth.users CSV export or a JSON array.",
    );
  }
  const records =
    format === "csv"
      ? readCsvRecords(filePath)
      : readJsonArrayRecords(filePath);
  let row = 0;
  for await (const record of records) {
    row += 1;
    yield adaptSupabaseUser(record, row);
  }
}

export function adaptSupabaseUser(
  source: SourceRecord,
  row: number,
): CanonicalUserRecord {
  const externalId = optionalString(source.id);
  if (!externalId) {
    throw new ImportSourceError(
      `Supabase row ${row} does not contain a stable id.`,
    );
  }
  if (optionalString(source.deleted_at)) {
    throw new ImportSourceError(
      `Supabase row ${row} is deleted and cannot be imported as an active user.`,
    );
  }
  assertNotActivelyBanned(source.banned_until, row);
  const email = optionalString(source.email);
  const phone = optionalString(source.phone);
  const userMetadata = optionalObject(
    source.raw_user_meta_data ?? source.user_metadata,
    `Supabase row ${row} raw_user_meta_data`,
  );
  const appMetadata = optionalObject(
    source.raw_app_meta_data ?? source.app_metadata,
    `Supabase row ${row} raw_app_meta_data`,
  );
  const name = supabaseName(userMetadata);
  const imageUrl =
    optionalString(userMetadata?.avatar_url) ??
    optionalString(userMetadata?.picture);
  const password = directPassword(source.encrypted_password, "bcrypt");
  const externalAccounts = supabaseExternalAccounts(source.identities, row);
  const createdAt = optionalTimestamp(
    source.created_at,
    `Supabase row ${row} created_at`,
  );

  return {
    type: "user",
    external_id: externalId,
    ...(email
      ? {
          email,
          email_verified: Boolean(optionalString(source.email_confirmed_at)),
        }
      : {}),
    ...(phone
      ? {
          phone,
          phone_verified: Boolean(optionalString(source.phone_confirmed_at)),
        }
      : {}),
    ...(name ? { name } : {}),
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(password ? { password } : {}),
    ...(externalAccounts.length > 0
      ? { external_accounts: externalAccounts }
      : {}),
    ...(appMetadata ? { private_metadata: appMetadata } : {}),
    ...(userMetadata ? { unsafe_metadata: userMetadata } : {}),
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}

function supabaseName(
  metadata: Record<string, unknown> | undefined,
): string | undefined {
  return (
    optionalString(metadata?.full_name) ??
    optionalString(metadata?.name) ??
    joinedName(metadata?.first_name, metadata?.last_name)
  );
}

function supabaseExternalAccounts(
  value: unknown,
  row: number,
): CanonicalExternalAccount[] {
  if (value === undefined || value === null || value === "") return [];
  let identities: unknown = value;
  if (typeof value === "string") {
    try {
      identities = JSON.parse(value);
    } catch {
      throw new ImportSourceError(
        `Supabase row ${row} identities must be a JSON array.`,
      );
    }
  }
  if (!Array.isArray(identities)) {
    throw new ImportSourceError(
      `Supabase row ${row} identities must be a JSON array.`,
    );
  }
  return identities.flatMap((identity, index) => {
    if (!isRecord(identity)) {
      throw new ImportSourceError(
        `Supabase row ${row} identity ${index + 1} is not an object.`,
      );
    }
    const provider = optionalString(identity.provider);
    if (!provider || provider === "email" || provider === "phone") return [];
    const identityData = optionalObject(
      identity.identity_data,
      `Supabase row ${row} identity ${index + 1} identity_data`,
    );
    const providerUserId =
      optionalString(identity.provider_id) ?? optionalString(identityData?.sub);
    if (!providerUserId) {
      throw new ImportSourceError(
        `Supabase row ${row} identity ${index + 1} lacks provider_id.`,
      );
    }
    const accountEmail =
      optionalString(identity.email) ?? optionalString(identityData?.email);
    const emailVerified = optionalBoolean(
      identityData?.email_verified,
      `Supabase row ${row} identity ${index + 1} email_verified`,
    );
    return [
      {
        provider: normalizedScheme(provider),
        provider_user_id: providerUserId,
        ...(accountEmail ? { email: accountEmail } : {}),
        ...(emailVerified === undefined
          ? {}
          : { email_verified: emailVerified }),
      },
    ];
  });
}

function assertNotActivelyBanned(value: unknown, row: number): void {
  const raw = optionalString(value);
  if (!raw) return;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now()) {
    throw new ImportSourceError(
      `Supabase row ${row} is banned and cannot be imported as an active user.`,
    );
  }
}
